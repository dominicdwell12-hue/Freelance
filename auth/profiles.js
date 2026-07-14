const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ------------------------------------------------------------
// GET /profiles/me — current user's profile (client or freelancer)
// ------------------------------------------------------------
router.get('/me', requireAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT id, email, role, full_name, country, phone, profile_photo_url, is_premium, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    if (user.role === 'freelancer') {
      const profileResult = await pool.query(
        `SELECT fp.*, COALESCE(json_agg(DISTINCT s.name) FILTER (WHERE s.name IS NOT NULL), '[]') AS skills
         FROM freelancer_profiles fp
         LEFT JOIN freelancer_skills fs ON fs.freelancer_id = fp.user_id
         LEFT JOIN skills s ON s.id = fs.skill_id
         WHERE fp.user_id = $1
         GROUP BY fp.user_id`,
        [user.id]
      );
      user.freelancer_profile = profileResult.rows[0] || null;
    }

    return res.json({ user });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
});

// ------------------------------------------------------------
// PATCH /profiles/freelancer — update freelancer-specific fields
// ------------------------------------------------------------
router.patch(
  '/freelancer',
  requireAuth,
  requireRole('freelancer'),
  [
    body('headline').optional().trim().isLength({ max: 200 }),
    body('bio').optional().trim(),
    body('pricing_type').optional().isIn(['hourly', 'fixed']),
    body('hourly_rate').optional().isFloat({ min: 0 }),
    body('experience_years').optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const fields = ['headline', 'bio', 'pricing_type', 'hourly_rate', 'experience_years'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const field of fields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${idx}`);
        values.push(req.body[field]);
        idx++;
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    values.push(req.user.id);

    try {
      const result = await pool.query(
        `UPDATE freelancer_profiles SET ${updates.join(', ')}, updated_at = now()
         WHERE user_id = $${idx} RETURNING *`,
        values
      );
      return res.json({ profile: result.rows[0] });
    } catch (err) {
      console.error('Update profile error:', err);
      return res.status(500).json({ error: 'Failed to update profile' });
    }
  }
);

module.exports = router;
