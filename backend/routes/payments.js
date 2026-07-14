const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getProvider, getProviderNames } = require('../services/payments');

const router = express.Router();

// ------------------------------------------------------------
// POST /payments/:paymentId/fund — client funds escrow for a hired job
// Kicks off a hosted checkout with the chosen provider; the payment stays
// 'pending' until the webhook confirms success.
// ------------------------------------------------------------
router.post(
  '/:paymentId/fund',
  requireAuth,
  requireRole('client'),
  [body('provider').isIn(getProviderNames())],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { paymentId } = req.params;
    const { provider: providerName, currency } = req.body;

    try {
      const [rows] = await pool.query(
        `SELECT p.*, u.email AS client_email
         FROM payments p
         JOIN users u ON u.id = p.client_id
         WHERE p.id = ?`,
        [paymentId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const payment = rows[0];

      if (payment.client_id !== req.user.id) {
        return res.status(403).json({ error: 'This is not your payment to fund' });
      }
      if (payment.status !== 'pending') {
        return res.status(409).json({ error: `Payment is already ${payment.status}` });
      }

      const provider = getProvider(providerName);
      const reference = `escrow_${payment.id}_${uuidv4().slice(0, 8)}`;

      const result = await provider.initializeTransaction({
        amount: Number(payment.amount),
        currency: currency || 'NGN',
        email: payment.client_email,
        reference,
        callbackUrl: `${process.env.CLIENT_URL}/payments/${payment.id}/callback`,
      });

      await pool.query(
        `UPDATE payments SET provider = ?, provider_ref = ? WHERE id = ?`,
        [providerName, result.reference, payment.id]
      );

      return res.json({ authorizationUrl: result.authorizationUrl, reference: result.reference });
    } catch (err) {
      console.error('Fund escrow error:', err);
      return res.status(500).json({ error: 'Failed to initialize payment' });
    }
  }
);

// ------------------------------------------------------------
// POST /payments/webhook/:provider — provider calls this on charge/transfer events
// No auth middleware (providers can't send a JWT) — trust is established via
// each provider's own signature scheme instead.
// ------------------------------------------------------------
router.post('/webhook/:provider', async (req, res) => {
  const { provider: providerName } = req.params;

  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return res.status(400).json({ error: 'Unknown provider' });
  }

  if (!provider.verifyWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  const event = provider.parseWebhookEvent(req);

  // Always 200 quickly once signature is verified — providers retry aggressively
  // on non-2xx, and we don't want retries piling up while we do DB work.
  res.status(200).json({ received: true });

  if (event.type !== 'charge.success' || !event.reference) return;

  try {
    const [result] = await pool.query(
      `UPDATE payments SET status = 'held', held_at = CURRENT_TIMESTAMP
       WHERE provider_ref = ? AND status = 'pending'`,
      [event.reference]
    );

    if (result.affectedRows > 0) {
      // TODO: notify client + freelancer that escrow is funded and work can begin
      console.log(`Escrow held for payment with provider_ref ${event.reference}`);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

// ------------------------------------------------------------
// POST /payments/:paymentId/release — client approves work, escrow releases
// Credits the freelancer's withdrawable balance and marks the job completed.
// ------------------------------------------------------------
router.post('/:paymentId/release', requireAuth, requireRole('client'), async (req, res) => {
  const { paymentId } = req.params;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [paymentRows] = await connection.query(`SELECT * FROM payments WHERE id = ? FOR UPDATE`, [paymentId]);

    if (paymentRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = paymentRows[0];

    if (payment.client_id !== req.user.id) {
      await connection.rollback();
      return res.status(403).json({ error: 'This is not your payment to release' });
    }
    if (payment.status !== 'held') {
      await connection.rollback();
      return res.status(409).json({ error: `Payment must be 'held' to release (currently '${payment.status}')` });
    }

    await connection.query(
      `UPDATE payments SET status = 'released', released_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [paymentId]
    );

    await connection.query(
      `UPDATE freelancer_profiles SET available_balance = available_balance + ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
      [payment.freelancer_payout, payment.freelancer_id]
    );

    await connection.query(
      `UPDATE jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [payment.job_id]
    );

    await connection.commit();

    return res.json({ message: 'Payment released. Job marked completed.' });
  } catch (err) {
    await connection.rollback();
    console.error('Release payment error:', err);
    return res.status(500).json({ error: 'Failed to release payment' });
  } finally {
    connection.release();
  }
});

// ------------------------------------------------------------
// POST /payments/:paymentId/dispute — either party flags a problem instead of releasing
// ------------------------------------------------------------
router.post(
  '/:paymentId/dispute',
  requireAuth,
  [body('reason').trim().isLength({ min: 10 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { paymentId } = req.params;
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const [paymentRows] = await connection.query(`SELECT * FROM payments WHERE id = ? FOR UPDATE`, [paymentId]);
      if (paymentRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Payment not found' });
      }

      const payment = paymentRows[0];
      const isParty = payment.client_id === req.user.id || payment.freelancer_id === req.user.id;
      if (!isParty) {
        await connection.rollback();
        return res.status(403).json({ error: 'You are not a party to this payment' });
      }
      if (payment.status !== 'held') {
        await connection.rollback();
        return res.status(409).json({ error: 'Only funded (held) escrow can be disputed' });
      }

      const disputeId = uuidv4();
      await connection.query(
        `INSERT INTO disputes (id, job_id, payment_id, raised_by, reason) VALUES (?, ?, ?, ?, ?)`,
        [disputeId, payment.job_id, payment.id, req.user.id, req.body.reason]
      );
      await connection.query(
        `UPDATE jobs SET status = 'disputed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [payment.job_id]
      );

      await connection.commit();
      return res.status(201).json({ message: 'Dispute filed. An admin will review and resolve it manually.' });
    } catch (err) {
      await connection.rollback();
      console.error('File dispute error:', err);
      return res.status(500).json({ error: 'Failed to file dispute' });
    } finally {
      connection.release();
    }
  }
);

module.exports = router;
