const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, query, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// POST /jobs — client posts a new job
// ------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole('client'),
  [
    body('title').trim().isLength({ min: 5, max: 200 }),
    body('description').trim().isLength({ min: 20 }),
    body('category_id').optional().isInt(),
    body('budget_min').optional().isFloat({ min: 0 }),
    body('budget_max').optional().isFloat({ min: 0 }),
    body('pricing_type').optional().isIn(['hourly', 'fixed']),
    body('deadline').optional().isISO8601(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const {
      title, description, category_id, budget_min, budget_max,
      pricing_type, deadline,
    } = req.body;

    try {
      const jobId = uuidv4();
      await pool.query(
        `INSERT INTO jobs (id, client_id, category_id, title, description, budget_min, budget_max, pricing_type, deadline)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          jobId, req.user.id, category_id || null, title, description,
          budget_min || null, budget_max || null, pricing_type || 'fixed', deadline || null,
        ]
      );

      const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ?`, [jobId]);
      return res.status(201).json({ job: rows[0] });
    } catch (err) {
      console.error('Create job error:', err);
      return res.status(500).json({ error: 'Failed to create job' });
    }
  }
);

// ------------------------------------------------------------
// GET /jobs — browse/search open jobs
// ?category_id=&skill_id=&q=&min_budget=&max_budget=&page=&limit=
// ------------------------------------------------------------
router.get('/', async (req, res) => {
  const { category_id, skill_id, q, min_budget, max_budget } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;

  const where = [`j.status = 'open'`];
  const params = [];

  if (category_id) {
    where.push('j.category_id = ?');
    params.push(category_id);
  }
  if (min_budget) {
    where.push('(j.budget_max IS NULL OR j.budget_max >= ?)');
    params.push(min_budget);
  }
  if (max_budget) {
    where.push('(j.budget_min IS NULL OR j.budget_min <= ?)');
    params.push(max_budget);
  }
  if (q) {
    where.push('(j.title LIKE ? OR j.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  let skillJoin = '';
  if (skill_id) {
    skillJoin = 'JOIN job_skills js ON js.job_id = j.id AND js.skill_id = ?';
    params.unshift(skill_id);
  }

  try {
    const [rows] = await pool.query(
      `SELECT j.*, c.name AS category_name,
              (SELECT COUNT(*) FROM proposals p WHERE p.job_id = j.id) AS proposal_count
       FROM jobs j
       ${skillJoin}
       LEFT JOIN categories c ON c.id = j.category_id
       WHERE ${where.join(' AND ')}
       ORDER BY j.is_featured DESC, j.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({ jobs: rows, page, limit });
  } catch (err) {
    console.error('List jobs error:', err);
    return res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// ------------------------------------------------------------
// GET /jobs/:id — job detail
// ------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.*, c.name AS category_name, u.full_name AS client_name
       FROM jobs j
       LEFT JOIN categories c ON c.id = j.category_id
       JOIN users u ON u.id = j.client_id
       WHERE j.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Job not found' });
    return res.json({ job: rows[0] });
  } catch (err) {
    console.error('Get job error:', err);
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// ------------------------------------------------------------
// PATCH /jobs/:id — client edits their own job (only while open)
// ------------------------------------------------------------
router.patch('/:id', requireAuth, requireRole('client'), async (req, res) => {
  const fields = ['title', 'description', 'category_id', 'budget_min', 'budget_max', 'pricing_type', 'deadline'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }

  try {
    const [ownership] = await pool.query(`SELECT client_id, status FROM jobs WHERE id = ?`, [req.params.id]);
    if (ownership.length === 0) return res.status(404).json({ error: 'Job not found' });
    if (ownership[0].client_id !== req.user.id) return res.status(403).json({ error: 'This is not your job posting' });
    if (ownership[0].status !== 'open') return res.status(409).json({ error: 'Only open jobs can be edited' });

    values.push(req.params.id);
    await pool.query(`UPDATE jobs SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ?`, [req.params.id]);
    return res.json({ job: rows[0] });
  } catch (err) {
    console.error('Update job error:', err);
    return res.status(500).json({ error: 'Failed to update job' });
  }
});

// ------------------------------------------------------------
// POST /jobs/:id/cancel — client cancels their own open job
// ------------------------------------------------------------
router.post('/:id/cancel', requireAuth, requireRole('client'), async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE jobs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND client_id = ? AND status = 'open'`,
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(409).json({ error: 'Job not found, not yours, or no longer cancellable' });
    }

    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ?`, [req.params.id]);
    return res.json({ job: rows[0] });
  } catch (err) {
    console.error('Cancel job error:', err);
    return res.status(500).json({ error: 'Failed to cancel job' });
  }
});

module.exports = router;
