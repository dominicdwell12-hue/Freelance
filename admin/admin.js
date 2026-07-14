const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// All routes below require an authenticated admin
router.use(requireAuth, requireRole('admin'));

// ------------------------------------------------------------
// GET /admin/disputes — queue of open/under-review disputes
// ------------------------------------------------------------
router.get('/disputes', async (req, res) => {
  const { status = 'open' } = req.query;

  try {
    const result = await pool.query(
      `SELECT d.*, j.title AS job_title, p.amount, p.commission_amount, p.freelancer_payout,
              cu.full_name AS client_name, fu.full_name AS freelancer_name
       FROM disputes d
       JOIN jobs j ON j.id = d.job_id
       LEFT JOIN payments p ON p.id = d.payment_id
       JOIN users cu ON cu.id = j.client_id
       LEFT JOIN users fu ON fu.id = j.hired_freelancer_id
       WHERE d.status = $1
       ORDER BY d.created_at ASC`,
      [status]
    );
    return res.json({ disputes: result.rows });
  } catch (err) {
    console.error('List disputes error:', err);
    return res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

// ------------------------------------------------------------
// POST /admin/disputes/:id/resolve — the only place escrow funds move
// without either party's direct action. Three resolutions:
//   - release_to_freelancer: pay the freelancer in full (as originally split)
//   - refund_to_client:      nothing paid out, client gets their funds back
//   - split:                 admin sets an explicit freelancer_amount; remainder
//                            is treated as refunded to the client
// This never touches available_balance/job status until the resolution is
// chosen — no silent auto-resolve exists anywhere else in the codebase.
// ------------------------------------------------------------
router.post(
  '/disputes/:id/resolve',
  [
    body('resolution').isIn(['release_to_freelancer', 'refund_to_client', 'split']),
    body('split_freelancer_amount').if(body('resolution').equals('split')).isFloat({ min: 0 }),
    body('resolution_note').trim().isLength({ min: 5 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { id } = req.params;
    const { resolution, split_freelancer_amount, resolution_note } = req.body;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const disputeResult = await client.query(
        `SELECT d.*, p.id AS payment_id, p.amount, p.status AS payment_status, p.job_id, p.freelancer_id
         FROM disputes d
         JOIN payments p ON p.id = d.payment_id
         WHERE d.id = $1
         FOR UPDATE OF d, p`,
        [id]
      );

      if (disputeResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Dispute not found' });
      }

      const dispute = disputeResult.rows[0];

      if (dispute.status === 'resolved') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This dispute has already been resolved' });
      }
      if (dispute.payment_status !== 'held') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Payment must be 'held' to resolve (currently '${dispute.payment_status}')` });
      }

      let freelancerAmount = 0;
      let paymentStatus;
      let jobStatus;

      if (resolution === 'release_to_freelancer') {
        freelancerAmount = Number(dispute.amount);
        paymentStatus = 'released';
        jobStatus = 'completed';
      } else if (resolution === 'refund_to_client') {
        freelancerAmount = 0;
        paymentStatus = 'refunded';
        jobStatus = 'cancelled';
      } else {
        freelancerAmount = Number(split_freelancer_amount);
        if (freelancerAmount > Number(dispute.amount)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Split amount cannot exceed the total escrow amount' });
        }
        paymentStatus = 'partially_released';
        jobStatus = 'completed';
      }

      if (freelancerAmount > 0) {
        await client.query(
          `UPDATE freelancer_profiles SET available_balance = available_balance + $1, updated_at = now()
           WHERE user_id = $2`,
          [freelancerAmount, dispute.freelancer_id]
        );
      }

      await client.query(
        `UPDATE payments SET status = $1, released_at = now() WHERE id = $2`,
        [paymentStatus, dispute.payment_id]
      );

      await client.query(
        `UPDATE jobs SET status = $1, updated_at = now() WHERE id = $2`,
        [jobStatus, dispute.job_id]
      );

      await client.query(
        `UPDATE disputes SET status = 'resolved', resolution_note = $1, resolved_by = $2, resolved_at = now()
         WHERE id = $3`,
        [resolution_note, req.user.id, id]
      );

      await client.query('COMMIT');

      return res.json({
        message: `Dispute resolved: ${resolution}`,
        freelancer_amount: freelancerAmount,
        refunded_amount: Number(dispute.amount) - freelancerAmount,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Resolve dispute error:', err);
      return res.status(500).json({ error: 'Failed to resolve dispute' });
    } finally {
      client.release();
    }
  }
);

// ------------------------------------------------------------
// POST /admin/users/:id/suspend — deactivate an account (fraud, abuse, etc.)
// ------------------------------------------------------------
router.post('/users/:id/suspend', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = FALSE, updated_at = now() WHERE id = $1 RETURNING id, email, is_active`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Suspend user error:', err);
    return res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// ------------------------------------------------------------
// POST /admin/users/:id/reactivate
// ------------------------------------------------------------
router.post('/users/:id/reactivate', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE users SET is_active = TRUE, updated_at = now() WHERE id = $1 RETURNING id, email, is_active`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Reactivate user error:', err);
    return res.status(500).json({ error: 'Failed to reactivate user' });
  }
});

// ------------------------------------------------------------
// PATCH /admin/categories/:id — adjust commission rate per category
// ------------------------------------------------------------
router.patch(
  '/categories/:id',
  [body('commission_rate').isFloat({ min: 0, max: 100 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const result = await pool.query(
        `UPDATE categories SET commission_rate = $1 WHERE id = $2 RETURNING *`,
        [req.body.commission_rate, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
      return res.json({ category: result.rows[0] });
    } catch (err) {
      console.error('Update category error:', err);
      return res.status(500).json({ error: 'Failed to update category' });
    }
  }
);

// ------------------------------------------------------------
// POST /admin/jobs/:id/feature — approve a client's "featured job" purchase
// (payment for the feature itself is assumed handled out-of-band via the
// same payment providers; this just flips the flag once payment clears)
// ------------------------------------------------------------
router.post(
  '/jobs/:id/feature',
  [body('days').optional().isInt({ min: 1, max: 90 })],
  async (req, res) => {
    const days = req.body.days || 7;

    try {
      const result = await pool.query(
        `UPDATE jobs SET is_featured = TRUE, featured_until = now() + ($1 || ' days')::interval, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [days, req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Job not found' });
      return res.json({ job: result.rows[0] });
    } catch (err) {
      console.error('Feature job error:', err);
      return res.status(500).json({ error: 'Failed to feature job' });
    }
  }
);

module.exports = router;
