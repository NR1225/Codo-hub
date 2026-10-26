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
