const paystack = require('./paystackProvider');
const flutterwave = require('./flutterwaveProvider');
const stripe = require('./stripeProvider');

const PROVIDERS = {
  paystack,
  flutterwave,
  stripe,
};

function getProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(`Unknown or unconfigured payment provider: ${name}`);
  }
  return provider;
}

// Used by the webhook route, which needs to identify the provider from the
// URL param before it can verify/parse anything.
function getProviderNames() {
  return Object.keys(PROVIDERS);
}

module.exports = { getProvider, getProviderNames };
