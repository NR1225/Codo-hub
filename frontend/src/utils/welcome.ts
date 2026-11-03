// Қарсы алу беті браузерде бір рет қана көрсетіледі
const WELCOME_SEEN_KEY = 'kh-welcome-seen';

export function hasSeenWelcome(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    // localStorage қолжетімсіз — Welcome-ды қайта-қайта көрсетпеу үшін «көрді» деп санаймыз
    return true;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // елемеу
  }
}
