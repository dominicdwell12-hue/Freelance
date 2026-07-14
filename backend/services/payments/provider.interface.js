/**
 * Common interface every payment provider adapter implements.
 * This lets routes/payments.js and routes/withdrawals.js call any provider
 * identically, without knowing which one is behind `provider.name`.
 *
 * initializeTransaction({ amount, currency, email, reference, callbackUrl })
 *   -> { authorizationUrl, reference, raw }
 *   Kicks off a client-facing checkout/payment. `reference` is what we store
 *   in payments.provider_ref to reconcile the webhook later.
 *
 * verifyTransaction(reference)
 *   -> { status: 'success' | 'failed' | 'pending', amount, currency, raw }
 *   Used both as a webhook-independent poll/fallback and inside webhook
 *   handlers to double-check the event before trusting it.
 *
 * verifyWebhookSignature(req)
 *   -> boolean
 *   Each provider signs webhooks differently (header + secret combo).
 *   Must be checked before trusting any webhook payload.
 *
 * parseWebhookEvent(req)
 *   -> { type: 'charge.success' | 'charge.failed' | 'transfer.success' | 'transfer.failed' | 'unknown',
 *        reference, amount, currency, raw }
 *   Normalizes each provider's webhook payload shape into one shape.
 *
 * initiateTransfer({ amount, currency, destination, reason })
 *   -> { transferId, status, raw }
 *   Used for freelancer withdrawals. `destination` shape varies by provider
 *   (bank code + account number for Paystack/Flutterwave, connected account for Stripe) —
 *   see each adapter for what it expects in `destination`.
 */
module.exports = {};
