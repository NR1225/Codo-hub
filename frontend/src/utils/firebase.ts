import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

// Firebase configuration — will be initialized from SiteConfigContext
// No hardcoded API keys — these come from the backend /api/config endpoint
let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let isInitialized = false;

// Track if Firestore is blocked to prevent repeated connection attempts
let firestoreBlocked = false;

/**
 * Mark Firestore as blocked (called when blocking is detected)
 */
export const markFirestoreBlocked = () => {
  firestoreBlocked = true;
};

/**
 * Initialize Firebase with configuration from the backend.
 * Call this once on app startup after fetching site config.
 */
export const initializeFirebase = (config: {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}): boolean => {
  try {
    // Validate required config values
    const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    const missingKeys = requiredKeys.filter(key => !config[key as keyof typeof config]);

    if (missingKeys.length > 0) {
      console.warn('Firebase config is incomplete. Missing:', missingKeys.join(', '));
      firestoreBlocked = true;
      return false;
    }

    // Validate API key format
    if (config.apiKey && !config.apiKey.startsWith('AIza')) {
      console.warn('Firebase API key format appears invalid. API keys should start with "AIza"');
    }

    const firebaseConfig = {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
      ...(config.measurementId ? { measurementId: config.measurementId } : {}),
    };

    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isInitialized = true;

    console.log('Firebase initialized successfully from backend config');
    return true;
  } catch (error: any) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error';
    console.error('Firebase initialization failed:', errorMessage);

    firestoreBlocked = true;
    isInitialized = false;
    return false;
  }
};

/**
 * Check if Firebase has been initialized
 */
export const isFirebaseInitialized = (): boolean => {
  return isInitialized;
};

/**
 * Get Firestore instance.
 * Returns null if Firebase is not initialized.
 */
export const getFirebaseDb = (): Firestore | null => {
  return db;
};

/**
 * Check if Firestore is blocked (for use by other modules)
 */
export const isFirestoreBlocked = (): boolean => {
  return firestoreBlocked;
};
// ── Phone (SMS) verification via Firebase Auth ──
// Used only at registration: Firebase sends the SMS, we hand the resulting
// ID token to the backend, which turns it into its own phone_token.

let recaptchaVerifier: import('firebase/auth').RecaptchaVerifier | null = null;

/**
 * Send an SMS code to `phone` (E.164). `containerId` is the id of an empty
 * element that hosts the invisible reCAPTCHA.
 */
export const sendFirebaseSmsCode = async (
  phone: string,
  containerId: string,
): Promise<import('firebase/auth').ConfirmationResult> => {
  if (!app) throw new Error('Firebase is not configured');
  const { getAuth, RecaptchaVerifier, signInWithPhoneNumber } = await import('firebase/auth');
  const auth = getAuth(app);
  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  return signInWithPhoneNumber(auth, phone, recaptchaVerifier);
};

/**
 * Confirm the SMS code and return a Firebase ID token proving the phone.
 * The Firebase session itself isn't kept — our backend issues the real login.
 */
export const confirmFirebaseSmsCode = async (
  confirmation: import('firebase/auth').ConfirmationResult,
  code: string,
): Promise<string> => {
  const { getAuth, signOut } = await import('firebase/auth');
  const credential = await confirmation.confirm(code);
  const idToken = await credential.user.getIdToken();
  if (app) await signOut(getAuth(app)).catch(() => {});
  return idToken;
};
