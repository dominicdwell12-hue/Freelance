const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// POST /jobs/:jobId/proposals — freelancer submits a bid
// ------------------------------------------------------------
router.post(
  '/jobs/:jobId/proposals',
  requireAuth,
  requireRole('freelancer'),
  [
    body('cover_letter').trim().isLength({ min: 20 }),
    body('bid_amount').isFloat({ min: 1 }),
    body('estimated_days').optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { jobId } = req.params;
    const { cover_letter, bid_amount, estimated_days } = req.body;

    try {
      const [jobRows] = await pool.query(`SELECT id, status FROM jobs WHERE id = ?`, [jobId]);
      if (jobRows.length === 0) {
        return res.status(404).json({ error: 'Job not found' });
      }
      if (jobRows[0].status !== 'open') {
        return res.status(409).json({ error: 'This job is no longer accepting proposals' });
      }

      const proposalId = uuidv4();

      await pool.query(
        `INSERT INTO proposals (id, job_id, freelancer_id, cover_letter, bid_amount, estimated_days)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [proposalId, jobId, req.user.id, cover_letter, bid_amount, estimated_days || null]
      );

      const [rows] = await pool.query(`SELECT * FROM proposals WHERE id = ?`, [proposalId]);
      return res.status(201).json({ proposal: rows[0] });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'You already submitted a proposal for this job' });
      }
      console.error('Submit proposal error:', err);
      return res.status(500).json({ error: 'Failed to submit proposal' });
    }
  }
);

// ------------------------------------------------------------
// GET /jobs/:jobId/proposals — client compares proposals for their job
// ------------------------------------------------------------
router.get('/jobs/:jobId/proposals', requireAuth, requireRole('client'), async (req, res) => {
  const { jobId } = req.params;

  try {
    const [ownership] = await pool.query(`SELECT client_id FROM jobs WHERE id = ?`, [jobId]);
    if (ownership.length === 0) return res.status(404).json({ error: 'Job not found' });
    if (ownership[0].client_id !== req.user.id) {
      return res.status(403).json({ error: 'This is not your job posting' });
    }

    const [rows] = await pool.query(
      `SELECT p.*, u.full_name AS freelancer_name, u.profile_photo_url,
              fp.rating_avg, fp.rating_count, fp.hourly_rate, fp.pricing_type
       FROM proposals p
       JOIN users u ON u.id = p.freelancer_id
       LEFT JOIN freelancer_profiles fp ON fp.user_id = p.freelancer_id
       WHERE p.job_id = ?
       ORDER BY p.created_at ASC`,
      [jobId]
    );

    return res.json({ proposals: rows });
  } catch (err) {
    console.error('List proposals error:', err);
    return res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// ------------------------------------------------------------
// GET /proposals/mine — freelancer views their own submitted proposals
// ------------------------------------------------------------
router.get('/proposals/mine', requireAuth, requireRole('freelancer'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, j.title AS job_title, j.status AS job_status
       FROM proposals p
       JOIN jobs j ON j.id = p.job_id
       WHERE p.freelancer_id = ?
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    return res.json({ proposals: rows });
  } catch (err) {
    console.error('List my proposals error:', err);
    return res.status(500).json({ error: 'Failed to fetch your proposals' });
  }
});

// ------------------------------------------------------------
// POST /proposals/:id/hire — client accepts a proposal
// Transitions: job -> in_progress, proposal -> accepted, others -> rejected,
// creates a `pending` payment record awaiting escrow funding.
// ------------------------------------------------------------
router.post('/proposals/:id/hire', requireAuth, requireRole('client'), async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [proposalRows] = await connection.query(
      `SELECT p.*, j.client_id, j.status AS job_status, j.category_id
       FROM proposals p
       JOIN jobs j ON j.id = p.job_id
       WHERE p.id = ?
       FOR UPDATE`,
      [id]
    );

    if (proposalRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const proposal = proposalRows[0];

    if (proposal.client_id !== req.user.id) {
      await connection.rollback();
      return res.status(403).json({ error: 'This is not your job posting' });
    }
    if (proposal.job_status !== 'open') {
      await connection.rollback();
      return res.status(409).json({ error: 'This job is not open for hiring' });
    }

    // Accept this proposal, reject all others for the same job
    await connection.query(`UPDATE proposals SET status = 'accepted' WHERE id = ?`, [id]);
    await connection.query(
      `UPDATE proposals SET status = 'rejected' WHERE job_id = ? AND id != ? AND status = 'pending'`,
      [proposal.job_id, id]
    );

    // Move job to in_progress and lock in the freelancer
    await connection.query(
      `UPDATE jobs SET status = 'in_progress', hired_freelancer_id = ?, updated_at = NOW() WHERE id = ?`,
      [proposal.freelancer_id, proposal.job_id]
    );

    // Look up commission rate for this job's category (defaults to 15%)
    const [categoryRows] = await connection.query(
      `SELECT commission_rate FROM categories WHERE id = ?`,
      [proposal.category_id]
    );
    const commissionRate = categoryRows[0] ? Number(categoryRows[0].commission_rate) : 15;
    const bidAmount = Number(proposal.bid_amount);
    const commissionAmount = Math.round(bidAmount * (commissionRate / 100) * 100) / 100;
    const freelancerPayout = Math.round((bidAmount - commissionAmount) * 100) / 100;

    // Create the escrow payment record — status starts 'pending' until client funds it
    const paymentId = uuidv4();
    await connection.query(
      `INSERT INTO payments (id, job_id, client_id, freelancer_id, amount, commission_amount, freelancer_payout, provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [paymentId, proposal.job_id, req.user.id, proposal.freelancer_id, bidAmount, commissionAmount, freelancerPayout, 'unset']
    );

    await connection.commit();

    const [paymentRows] = await pool.query(`SELECT * FROM payments WHERE id = ?`, [paymentId]);

    return res.json({
      message: 'Freelancer hired. Fund escrow to begin the project.',
      job_id: proposal.job_id,
      payment: paymentRows[0],
    });
  } catch (err) {
    await connection.rollback();
    console.error('Hire proposal error:', err);
    return res.status(500).json({ error: 'Failed to hire freelancer' });
  } finally {
    connection.release();
  }
});

// ------------------------------------------------------------
// POST /proposals/:id/withdraw — freelancer withdraws their own pending proposal
// ------------------------------------------------------------
router.post('/proposals/:id/withdraw', requireAuth, requireRole('freelancer'), async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE proposals SET status = 'withdrawn' WHERE id = ? AND freelancer_id = ? AND status = 'pending'`,
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Proposal not found, not yours, or no longer withdrawable' });
    }

    const [rows] = await pool.query(`SELECT * FROM proposals WHERE id = ?`, [req.params.id]);
    return res.json({ proposal: rows[0] });
  } catch (err) {
    console.error('Withdraw proposal error:', err);
    return res.status(500).json({ error: 'Failed to withdraw proposal' });
  }
});

module.exports = router;
