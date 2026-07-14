// Flutterwave adapter — real API calls to https://api.flutterwave.com/v3.
// Docs: https://developer.flutterwave.com/docs/collecting-payments/standard
const crypto = require('crypto');

const BASE_URL = 'https://api.flutterwave.com/v3';

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function initializeTransaction({ amount, currency, email, reference, callbackUrl }) {
  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      tx_ref: reference,
      amount,
      currency: currency || 'NGN',
      redirect_url: callbackUrl,
      customer: { email },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || 'Flutterwave initialize failed');
  }
  return {
    authorizationUrl: data.data.link,
    reference,
    raw: data,
  };
}

async function verifyTransaction(reference) {
  const res = await fetch(`${BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    return { status: 'failed', amount: 0, currency: null, raw: data };
  }
  const status = data.data.status === 'successful' ? 'success' : data.data.status === 'pending' ? 'pending' : 'failed';
  return { status, amount: data.data.amount, currency: data.data.currency, raw: data };
}

function verifyWebhookSignature(req) {
  if (!process.env.FLUTTERWAVE_WEBHOOK_HASH) return false;
  const signature = req.headers['verif-hash'];
  return signature === process.env.FLUTTERWAVE_WEBHOOK_HASH;
}

function parseWebhookEvent(req) {
  const event = req.body || {};
  const type = event.event === 'charge.completed' && event.data?.status === 'successful' ? 'charge.success' : 'unknown';
  return {
    type,
    reference: event.data?.tx_ref,
    amount: event.data?.amount,
    currency: event.data?.currency,
    raw: event,
  };
}

async function initiateTransfer({ amount, currency, destination, reason }) {
  const res = await fetch(`${BASE_URL}/transfers`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      account_bank: destination.bankCode,
      account_number: destination.accountNumber,
      amount,
      currency: currency || 'NGN',
      narration: reason,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(data.message || 'Flutterwave transfer failed');
  }
  return {
    transferId: data.data.id,
    status: data.data.status === 'SUCCESSFUL' ? 'success' : 'pending',
    raw: data,
  };
}

module.exports = {
  name: 'flutterwave',
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  parseWebhookEvent,
  initiateTransfer,
};
