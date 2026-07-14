// Stripe adapter — uses the official `stripe` npm package.
// Docs: https://docs.stripe.com/checkout/quickstart
const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');

async function initializeTransaction({ amount, currency, email, reference, callbackUrl }) {
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    client_reference_id: reference,
    line_items: [
      {
        price_data: {
          currency: (currency || 'usd').toLowerCase(),
          product_data: { name: 'Escrow funding' },
          unit_amount: Math.round(Number(amount) * 100),
        },
        quantity: 1,
      },
    ],
    success_url: `${callbackUrl}?status=success`,
    cancel_url: `${callbackUrl}?status=cancelled`,
  });
  return {
    authorizationUrl: session.url,
    reference: session.id,
    raw: session,
  };
}

async function verifyTransaction(reference) {
  const session = await stripe.checkout.sessions.retrieve(reference);
  const status = session.payment_status === 'paid' ? 'success' : session.status === 'expired' ? 'failed' : 'pending';
  return {
    status,
    amount: session.amount_total ? session.amount_total / 100 : 0,
    currency: session.currency,
    raw: session,
  };
}

// NOTE: this is a structural stand-in. Real Stripe signature verification
// needs the raw request body (not JSON-parsed) and stripe.webhooks.constructEvent —
// swap this in before production, using an express.raw() body parser on this route.
function verifyWebhookSignature(req) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return false;
  try {
    stripe.webhooks.constructEvent(req.rawBody || JSON.stringify(req.body), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
    return true;
  } catch (err) {
    return false;
  }
}

function parseWebhookEvent(req) {
  const event = req.body || {};
  const type = event.type === 'checkout.session.completed' ? 'charge.success' : 'unknown';
  const session = event.data?.object || {};
  return {
    type,
    reference: session.id,
    amount: session.amount_total ? session.amount_total / 100 : null,
    currency: session.currency,
    raw: event,
  };
}

async function initiateTransfer({ amount, currency, destination, reason }) {
  const transfer = await stripe.transfers.create({
    amount: Math.round(Number(amount) * 100),
    currency: (currency || 'usd').toLowerCase(),
    destination: destination.connectedAccountId,
    description: reason,
  });
  return {
    transferId: transfer.id,
    status: 'success',
    raw: transfer,
  };
}

module.exports = {
  name: 'stripe',
  initializeTransaction,
  verifyTransaction,
  verifyWebhookSignature,
  parseWebhookEvent,
  initiateTransfer,
};
