// Stripe Terminal bridge for the driver app.
//
// Provides:
//   - tokenProvider(): called by the SDK whenever it needs a connection token.
//     Backed by our /api/payments/connection-token endpoint.
//   - createTapToPayIntent(): creates a card_present PaymentIntent for a ride.
//
// Actual reader discovery / tap collection / payment processing happens in
// the PaymentCollectionScreen via the useStripeTerminal() hook.

import httpClient from './httpClient';

export async function tokenProvider(): Promise<string> {
  const res = await httpClient.post('/payments/connection-token', {});
  const secret = res?.data?.secret;
  if (!secret) {
    throw new Error('Terminal connection token missing from response');
  }
  return secret;
}

export type CreateIntentArgs = {
  amount: number; // cents
  currency?: string;
  jobId?: string;
  customerId?: string;
};

export type CreatedIntent = {
  paymentIntentId: string;
  clientSecret: string;
};

export async function getTerminalLocationId(): Promise<string> {
  const res = await httpClient.get('/payments/terminal/location');
  const id = res?.data?.locationId;
  if (!id) throw new Error('Terminal location ID missing from response');
  return id;
}

export async function createTapToPayIntent(
  args: CreateIntentArgs,
): Promise<CreatedIntent> {
  const res = await httpClient.post('/payments/terminal/create-intent', {
    amount: Math.round(args.amount),
    currency: args.currency || 'nzd',
    jobId: args.jobId,
    customerId: args.customerId,
  });
  const { paymentIntentId, clientSecret } = res.data || {};
  if (!paymentIntentId || !clientSecret) {
    throw new Error('Terminal PaymentIntent response missing fields');
  }
  return { paymentIntentId, clientSecret };
}
