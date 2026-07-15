'use strict';

/**
 * Public surface of the provider layer.
 */

const { VerificationProvider } = require('./base');
const result = require('./result');
const registry = require('./registry');

const { StripeIdentityProvider } = require('./stripeIdentity');
const { PersonaProvider } = require('./persona');
const { OfacProvider } = require('./ofac');
const { OpenCorporatesProvider } = require('./openCorporates');
const { TwilioLookupProvider } = require('./twilioLookup');
const { EmailOtpProvider } = require('./emailOtp');

module.exports = {
  VerificationProvider,
  ...result,
  ...registry,
  StripeIdentityProvider,
  PersonaProvider,
  OfacProvider,
  OpenCorporatesProvider,
  TwilioLookupProvider,
  EmailOtpProvider,
};
