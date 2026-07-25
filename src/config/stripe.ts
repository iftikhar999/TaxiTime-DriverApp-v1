/**
 * Stripe Configuration
 * 
 * Provides Stripe publishable keys and configuration for payment processing.
 * Supports Payment Sheet, Card Scan, and NFC Tap-to-Pay.
 */

import { Platform } from 'react-native';

// ⚠️ Stripe publishable key is read from react-native-config at build time.
// Set STRIPE_PUBLISHABLE_KEY in .env (see .env.example). In DEV we fall back
// to a warning + empty string so the app boots; in PROD we throw at init.

let envStripeKey: string | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Config = require('react-native-config').default ?? require('react-native-config');
  envStripeKey = Config?.STRIPE_PUBLISHABLE_KEY;
} catch {
  envStripeKey = undefined;
}

const resolveStripeKey = (): string => {
  const trimmed = typeof envStripeKey === 'string' ? envStripeKey.trim() : '';
  if (trimmed.length > 0) {
    return trimmed;
  }
  if (__DEV__) {
    console.warn(
      '[stripe] STRIPE_PUBLISHABLE_KEY not set — payments will be disabled. ' +
        'Add it to .env and rebuild.'
    );
    return '';
  }
  throw new Error(
    '[stripe] STRIPE_PUBLISHABLE_KEY is required in production builds.'
  );
};

export const STRIPE_CONFIG = {
  // Publishable key (pk_test_* in dev, pk_live_* in prod) loaded from .env
  publishableKey: resolveStripeKey(),
  
  // Merchant identifier for Apple Pay (iOS only)
  merchantIdentifier: 'merchant.com.abtaxi.driver',
  
  // URL scheme for return URL (for 3D Secure, etc.)
  urlScheme: 'abtaxi-driver',
  
  // Enable Google Pay (Android)
  googlePay: {
    enabled: Platform.OS === 'android',
    merchantName: 'AB Taxi',
    countryCode: 'NZ', // New Zealand
    currencyCode: 'NZD',
    testEnv: true, // Set to false in production
  },
  
  // Enable Apple Pay (iOS)
  applePay: {
    enabled: Platform.OS === 'ios',
    merchantIdentifier: 'merchant.com.abtaxi.driver',
    merchantCountryCode: 'NZ',
  },
  
  // Card Scan configuration
  cardScan: {
    enabled: true, // Enable camera-based card scanning
  },
  
  // NFC Tap-to-Pay configuration
  tapToPay: {
    enabled: Platform.OS === 'android', // Currently Android-only
    // iOS Tap-to-Pay requires special Apple approval
  },
};

/**
 * Get Stripe publishable key for current environment
 */
export const getStripePublishableKey = (): string => {
  return STRIPE_CONFIG.publishableKey;
};

/**
 * Check if payment method is supported on current platform
 */
export const isPaymentMethodSupported = (method: 'googlePay' | 'applePay' | 'cardScan' | 'tapToPay'): boolean => {
  switch (method) {
    case 'googlePay':
      return STRIPE_CONFIG.googlePay.enabled;
    case 'applePay':
      return STRIPE_CONFIG.applePay.enabled;
    case 'cardScan':
      return STRIPE_CONFIG.cardScan.enabled;
    case 'tapToPay':
      return STRIPE_CONFIG.tapToPay.enabled;
    default:
      return false;
  }
};

export default STRIPE_CONFIG;

