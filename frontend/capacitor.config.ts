import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync } from 'fs';
import { join } from 'path';

// Бэкенд адресі .env.android-тан алынады. WebView-тың ішкі адресі бэкендпен бір хостта
// болуы керек: әйтпесе refresh-token cookie «үшінші тарап» болып, Android оны бұғаттайды.
const envFile = (() => {
  try { return readFileSync(join(__dirname, '.env.android'), 'utf-8'); } catch { return ''; }
})();
const apiUrl = new URL(
  envFile.match(/^VITE_API_BASE_URL=(.+)$/m)?.[1]?.trim() || 'https://localhost/api',
);
const isHttp = apiUrl.protocol === 'http:';

const config: CapacitorConfig = {
  appId: 'com.codohub.app',
  appName: 'Codo Hub',
  webDir: 'dist',
  server: {
    androidScheme: isHttp ? 'http' : 'https',
    hostname: apiUrl.hostname,
    // Жергілікті желідегі http бэкенд үшін
    cleartext: isHttp,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    FirebaseAuthentication: {
      // Тек Google token-ін аламыз; Firebase-ке кіруді JS SDK жасайды
      skipNativeAuth: true,
      providers: ['google.com'],
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0d1117',
      showSpinner: false,
    },
  },
};

export default config;
