const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/token');
const { sendVerificationEmail } = require('../utils/mailer');

const router = express.Router();
const SALT_ROUNDS = 12;

// ------------------------------------------------------------
// POST /auth/register
// ------------------------------------------------------------
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('full_name').trim().notEmpty(),
    body('role').isIn(['client', 'freelancer']),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, full_name, role, country } = req.body;

    try {
      const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
      if (existing.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const userId = uuidv4();

      await pool.query(
        `INSERT INTO users (id, email, password_hash, role, full_name, country, email_verify_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, email, passwordHash, role, full_name, country || null, verifyToken]
      );

      // Freelancers get a blank profile row created immediately
      if (role === 'freelancer') {
        await pool.query(`INSERT INTO freelancer_profiles (user_id) VALUES (?)`, [userId]);
      }

      await sendVerificationEmail(email, verifyToken);

      const [rows] = await pool.query(
        'SELECT id, email, role, full_name, created_at FROM users WHERE id = ?',
        [userId]
      );

      return res.status(201).json({
        message: 'Account created. Please check your email to verify your account.',
        user: rows[0],
      });
    } catch (err) {
      console.error('Register error:', err);
      return res.status(500).json({ error: 'Failed to create account' });
    }
  }
);

// ------------------------------------------------------------
// GET /auth/verify-email?token=...
// ------------------------------------------------------------
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing verification token' });

  try {
    const [result] = await pool.query(
      `UPDATE users SET email_verified = TRUE, email_verify_token = NULL
       WHERE email_verify_token = ?`,
      [token]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Invalid or already-used verification token' });
    }

    return res.json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('Verify email error:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});

// ------------------------------------------------------------
// POST /auth/login
// ------------------------------------------------------------
router.post(
  '/login',
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;

    try {
      const [rows] = await pool.query(
        `SELECT id, email, password_hash, role, full_name, email_verified, is_active
         FROM users WHERE email = ?`,
        [email]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = rows[0];

      if (!user.is_active) {
        return res.status(403).json({ error: 'This account has been deactivated' });
      }

      const passwordMatches = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (!user.email_verified) {
        return res.status(403).json({ error: 'Please verify your email before logging in' });
      }

      const accessToken = signAccessToken(user);
      const refreshToken = signRefreshToken(user);

      return res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          full_name: user.full_name,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
  }
);

// ------------------------------------------------------------
// POST /auth/refresh
// ------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refresh token' });

  try {
    const payload = verifyRefreshToken(refreshToken);

    const [rows] = await pool.query(
      'SELECT id, email, role FROM users WHERE id = ? AND is_active = TRUE',
      [payload.sub]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User no longer valid' });
    }

    const newAccessToken = signAccessToken(rows[0]);
    return res.json({ accessToken: newAccessToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

module.exports = router;
