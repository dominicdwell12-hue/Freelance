// Paystack adapter — real API calls to https://api.paystack.co.
// Docs: https://paystack.com/docs/payments/accept-payments
const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function initializeTransaction({ amount, currency, email, reference, callbackUrl }) {
  const res = await fetch(`${BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      // Paystack expects the smallest currency unit (kobo for NGN)
      amount: Math.round(Number(amount) * 100),
      currency: currency || 'NGN',
      email,
      reference,
      callback_url: callbackUrl,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Paystack initialize failed');
  }
  return {
    authorizationUrl: data.data.authorization_url,
    reference: data.data.reference,
    raw: data,
  };
}

async function verifyTransaction(reference) {
  const res = await fetch(`${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    return { status: 'failed', amount: 0, currency: null, raw: data };
  }
  const status = data.data.status === 'success' ? 'success' : data.data.status === 'abandoned' ? 'pending' : 'failed';
  return {
    status,
    amount: data.data.amount / 100,
    currency: data.data.currency,
    raw: data,
  };
}

function verifyWebhookSignature(req) {
  if (!process.env.PAYSTACK_SECRET_KEY) return false;
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return hash === signature;
}

function parseWebhookEvent(req) {
  const event = req.body || {};
  const type = event.event === 'charge.success' ? 'charge.success' : 'unknown';
  return {
    type,
    reference: event.data?.reference,
    amount: event.data?.amount ? event.data.amount / 100 : null,
    currency: event.data?.currency,
    raw: event,
  };
}

async function initiateTransfer({ amount, currency, destination, reason }) {
  // Requires a Paystack transfer recipient to already exist for `destination`
  // (bank code + account number). Creating the recipient is a separate call —
  // left out here since it should happen once at KYC time, not per withdrawal.
  const res = await fetch(`${BASE_URL}/transfer`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      source: 'balance',
      amount: Math.round(Number(amount) * 100),
      recipient: destination.recipientCode,
      reason,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(data.message || 'Paystack transfer failed');
  }
  return {
    transferId: data.data.transfer_code,
    status: data.data.status === 'success' ? 'success' : 'pending',
    raw: data,
  };
}

module.exports = {
  name: 'paystack',
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  parseWebhookEvent,
  initiateTransfer,
};
