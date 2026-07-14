require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profiles');
const jobRoutes = require('./routes/jobs');
const proposalRoutes = require('./routes/proposals');
const paymentRoutes = require('./routes/payments');
const withdrawalRoutes = require('./routes/withdrawals');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/auth', authRoutes);
app.use('/profiles', profileRoutes);
app.use('/jobs', jobRoutes);
// proposals.js defines its own full paths (/jobs/:jobId/proposals, /proposals/mine, etc.)
app.use('/', proposalRoutes);
app.use('/payments', paymentRoutes);
app.use('/withdrawals', withdrawalRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Freelance Marketplace API listening on port ${PORT}`);
});
