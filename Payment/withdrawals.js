const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { getProvider, getProviderNames } = require('../services/payments');

const router = express.Router();

// ------------------------------------------------------------
// POST /withdrawals — freelancer requests a payout from available_balance
// Requires KYC verification and sufficient balance. Balance is deducted
// immediately (held) so it can't be double-spent while the transfer processes.
// ------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole('freelancer'),
  [
    body('amount').isFloat({ min: 1 }),
    body('provider').isIn(getProviderNames()),
    body('destination').isObject(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { amount, provider: providerName, destination, currency } = req.body;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const profileResult = await client.query(
        `SELECT * FROM freelancer_profiles WHERE user_id = $1 FOR UPDATE`,
        [req.user.id]
      );
      const profile = profileResult.rows[0];

      if (!profile.kyc_verified_at) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Identity verification (KYC) is required before withdrawing funds' });
      }
      if (Number(profile.available_balance) < Number(amount)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Insufficient available balance' });
      }

      // Deduct immediately so the same balance can't fund two withdrawal requests
      await client.query(
        `UPDATE freelancer_profiles SET available_balance = available_balance - $1, updated_at = now()
         WHERE user_id = $2`,
        [amount, req.user.id]
      );

      const withdrawalResult = await client.query(
        `INSERT INTO withdrawals (freelancer_id, amount, provider, destination, status)
         VALUES ($1, $2, $3, $4, 'requested')
         RETURNING *`,
        [req.user.id, amount, providerName, JSON.stringify(destination)]
      );

      const withdrawal = withdrawalResult.rows[0];

      await client.query('COMMIT');

      // Attempt the actual transfer after committing the DB state, so a provider
      // outage doesn't roll back the balance deduction (avoids double-withdraw races).
      // Failure here just leaves status='requested' for manual/admin retry.
      try {
        const provider = getProvider(providerName);
        const transfer = await provider.initiateTransfer({
          amount: Number(amount),
          currency: currency || 'NGN',
          destination,
          reason: `Freelancer withdrawal ${withdrawal.id}`,
        });

        await pool.query(
          `UPDATE withdrawals SET status = $1, processed_at = CASE WHEN $1 = 'paid' THEN now() ELSE processed_at END
           WHERE id = $2`,
          [transfer.status === 'success' ? 'paid' : 'processing', withdrawal.id]
        );
      } catch (transferErr) {
        console.error('Transfer initiation failed (will need manual retry):', transferErr);
        await pool.query(`UPDATE withdrawals SET status = 'failed' WHERE id = $1`, [withdrawal.id]);
      }

      return res.status(201).json({ withdrawal });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Withdrawal request error:', err);
      return res.status(500).json({ error: 'Failed to process withdrawal request' });
    } finally {
      client.release();
    }
  }
);

// ------------------------------------------------------------
// GET /withdrawals/mine — freelancer's withdrawal history
// ------------------------------------------------------------
router.get('/mine', requireAuth, requireRole('freelancer'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM withdrawals WHERE freelancer_id = $1 ORDER BY requested_at DESC`,
      [req.user.id]
    );
    return res.json({ withdrawals: result.rows });
  } catch (err) {
    console.error('List withdrawals error:', err);
    return res.status(500).json({ error: 'Failed to fetch withdrawal history' });
  }
});

module.exports = router;
