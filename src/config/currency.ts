/**
 * Single source of truth for the app's currency.
 *
 * The whole platform must agree on ONE currency for both DISPLAY and the actual
 * charge. Previously the app showed "$" on Home, "£" in the wallet, and "NZD"
 * on the job offer — and cards were charged in NZD — which made a Qatar app
 * (+974 / Doha) look like an unfinished template. Everything now routes through
 * here; switch the whole app by changing CURRENCY_CODE in this one place.
 *
 * NOTE: CURRENCY_CODE is also sent as the Stripe charge currency. Confirm your
 * Stripe (connected) account supports it before going live; change here if not.
 */
export const CURRENCY_CODE = 'QAR';   // ISO 4217 (Qatari Riyal)
export const CURRENCY_SYMBOL = 'QAR'; // shown as a prefix, e.g. "QAR 25.00"

/** Format an amount as "QAR 25.00". Safe for null/undefined/NaN → "QAR 0.00". */
export const formatCurrency = (amount?: number | null): string => {
  const n = amount === undefined || amount === null || !Number.isFinite(amount) ? 0 : amount;
  return `${CURRENCY_SYMBOL} ${n.toFixed(2)}`;
};
