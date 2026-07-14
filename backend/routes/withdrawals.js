const express = require('express');
const { v4: uuidv4 } = require('uuid');
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
    const connection = await pool.getConnection();
    let withdrawalId;

    try {
      await connection.beginTransaction();

      const [profileRows] = await connection.query(
        `SELECT * FROM freelancer_profiles WHERE user_id = ? FOR UPDATE`,
        [req.user.id]
      );
      const profile = profileRows[0];

      if (!profile || !profile.kyc_verified_at) {
        await connection.rollback();
        return res.status(403).json({ error: 'Identity verification (KYC) is required before withdrawing funds' });
      }
      if (Number(profile.available_balance) < Number(amount)) {
        await connection.rollback();
        return res.status(400).json({ error: 'Insufficient available balance' });
      }

      // Deduct immediately so the same balance can't fund two withdrawal requests
      await connection.query(
        `UPDATE freelancer_profiles SET available_balance = available_balance - ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [amount, req.user.id]
      );

      withdrawalId = uuidv4();
      await connection.query(
        `INSERT INTO withdrawals (id, freelancer_id, amount, provider, destination, status)
         VALUES (?, ?, ?, ?, ?, 'requested')`,
        [withdrawalId, req.user.id, amount, providerName, JSON.stringify(destination)]
      );

      await connection.commit();

      // Attempt the actual transfer after committing the DB state, so a provider
      // outage doesn't roll back the balance deduction (avoids double-withdraw races).
      // Failure here just leaves status='requested' for manual/admin retry.
      try {
        const provider = getProvider(providerName);
        const transfer = await provider.initiateTransfer({
          amount: Number(amount),
          currency: currency || 'NGN',
          destination,
          reason: `Freelancer withdrawal ${withdrawalId}`,
        });

        await pool.query(
          `UPDATE withdrawals SET status = ?, processed_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE processed_at END
           WHERE id = ?`,
          [transfer.status === 'success' ? 'paid' : 'processing', transfer.status === 'success' ? 'paid' : 'processing', withdrawalId]
        );
      } catch (transferErr) {
        console.error('Transfer initiation failed (will need manual retry):', transferErr);
        await pool.query(`UPDATE withdrawals SET status = 'failed' WHERE id = ?`, [withdrawalId]);
      }

      const [rows] = await pool.query(`SELECT * FROM withdrawals WHERE id = ?`, [withdrawalId]);
      return res.status(201).json({ withdrawal: rows[0] });
    } catch (err) {
      await connection.rollback();
      console.error('Withdrawal request error:', err);
      return res.status(500).json({ error: 'Failed to process withdrawal request' });
    } finally {
      connection.release();
    }
  }
);

// ------------------------------------------------------------
// GET /withdrawals/mine — freelancer's withdrawal history
// ------------------------------------------------------------
router.get('/mine', requireAuth, requireRole('freelancer'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM withdrawals WHERE freelancer_id = ? ORDER BY requested_at DESC`,
      [req.user.id]
    );
    return res.json({ withdrawals: rows });
  } catch (err) {
    console.error('List withdrawals error:', err);
    return res.status(500).json({ error: 'Failed to fetch withdrawal history' });
  }
});

module.exports = router;
