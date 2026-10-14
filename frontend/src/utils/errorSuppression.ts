/**
 * Targeted suppression of known Firebase SDK console noise.
 *
 * Firebase Firestore and Auth SDKs produce noisy console output when:
 * - Ad blockers block requests to firestore.googleapis.com
 * - Firebase API keys are invalid or not configured
 * - Cross-Origin-Opener-Policy interactions occur
 *
 * This module ONLY filters console output. It does NOT monkey-patch
 * fetch, XMLHttpRequest, or global error/rejection handlers — those
 * aggressive patches hide real bugs and break error reporting.
 */

// Store original console methods
const originalError = console.error;
const originalWarn = console.warn;

// Firebase-specific patterns that are safe to suppress
const FIREBASE_NOISE_PATTERNS: RegExp[] = [
  // Ad-blocker blocked requests
  /ERR_BLOCKED_BY_CLIENT/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
  /net::ERR_CONNECTION_CLOSED/i,
  // Firestore channel errors (ad blocker related)
  /firestore\.googleapis\.com.*ERR_BLOCKED_BY_CLIENT/i,
  /firebase_firestore\.js/i,
  /google\.firestore\.v1\.Firestore/i,
  /Listen\/channel/i,
  /Write\/channel/i,
  /TYPE=terminate/i,
  /gsessionid/i,
  // Firebase Auth COOP issues
  /Cross-Origin-Opener-Policy/i,
  /firebase_auth\.js.*window\.(closed|close)/i,
  /poll @ firebase_auth\.js/i,
  /close @ firebase_auth\.js/i,
  // Firebase API key issues
  /API key not valid/i,
  /identitytoolkit\.googleapis\.com/i,
  /getProjectConfig/i,
  /INVALID_ARGUMENT/i,
  // Failed resource loads from Firebase domains
  /Failed to load resource.*apis\.google\.com/i,
  /Failed to load resource.*firestore\.googleapis\.com/i,
  // Russian localized Firebase errors
  /Пояснение к ошибке/i,
];

const FIREBASE_WARN_PATTERNS: RegExp[] = [
  /Firestore connection blocked.*ad blocker/i,
  /Firestore.*blocked.*non-critical/i,
];

/**
 * Check if a message matches Firebase noise patterns
 */
function isFirebaseNoise(message: string): boolean {
  return FIREBASE_NOISE_PATTERNS.some(pattern => pattern.test(message));
}

function isFirebaseWarning(message: string): boolean {
  return FIREBASE_WARN_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Store reference to Firestore blocking callback (set by firebase.ts)
 */
let markFirestoreBlockedFn: (() => void) | null = null;

/**
 * Set the function to mark Firestore as blocked (called from firebase.ts)
 */
export const setMarkFirestoreBlockedFn = (fn: () => void) => {
  markFirestoreBlockedFn = fn;
};

/**
 * Initialize targeted Firebase console noise suppression.
 *
 * Only filters console.error and console.warn output that matches known
 * Firebase SDK noise patterns. All other console output, errors, and
 * rejections pass through normally.
 */
export const initErrorSuppression = () => {
  // Filter console.error for Firebase noise
  console.error = (...args: any[]) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.message} ${arg.stack || ''}`;
      try { return JSON.stringify(arg); } catch { return String(arg); }
    }).join(' ');

    if (isFirebaseNoise(message)) {
      // Notify firebase.ts that Firestore may be blocked
      if (markFirestoreBlockedFn &&
          (message.includes('firebase_firestore') || message.includes('firestore.googleapis.com'))) {
        markFirestoreBlockedFn();
      }
      return; // suppress
    }

    originalError.apply(console, args);
  };

  // Filter console.warn for Firebase noise
  console.warn = (...args: any[]) => {
    const message = args.join(' ');

    if (isFirebaseWarning(message)) {
      return; // suppress
    }

    originalWarn.apply(console, args);
  };
};