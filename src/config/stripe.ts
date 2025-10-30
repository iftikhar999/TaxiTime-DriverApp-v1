/**
 * Stripe Configuration
 * 
 * Provides Stripe publishable keys and configuration for payment processing.
 * Supports Payment Sheet, Card Scan, and NFC Tap-to-Pay.
 */

import { Platform } from 'react-native';

// ⚠️ IMPORTANT: Replace with your actual Stripe publishable keys
// Get these from: https://dashboard.stripe.com/apikeys

export const STRIPE_CONFIG = {
  // Test mode publishable key (starts with pk_test_)
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE',
  
  // Production publishable key (starts with pk_live_)
  // publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_YOUR_KEY_HERE',
  
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

