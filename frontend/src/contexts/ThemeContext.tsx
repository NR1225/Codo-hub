import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { isAnimationOn } from './MotionContext';

type ThemePreference = 'auto' | 'light' | 'dark';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  theme: ResolvedTheme;
  preference: ThemePreference;
  setThemePreference: (pref: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

function getSystemTheme(): ResolvedTheme {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === 'auto') return getSystemTheme();
  return pref;
}

// Ауысу анимациясы диагональ бойынша жүреді (сол жақ жоғарғы ↔ оң жақ төменгі бұрыш).
// s — жолақтың жартылай ені: 0 — ортадағы диагональ сызығы, 1 — бүкіл экран.
function diagonalBand(s: number): string {
  const a = (1 - s) * 100;
  const b = s * 100;
  return `polygon(${a}% 0%, 100% 0%, 100% ${b}%, ${b}% 100%, 0% 100%, 0% ${a}%)`;
}

// Жолақтың сыртқы бөлігі — екі бұрыштағы үшбұрыш (жолақ ені s болғанда).
// Екі үшбұрыш бір polygon-да: сол жақ жоғарғы бұрыштан оң жақ төменгіге
// енсіз «көпір» арқылы жалғанады (ол екі рет қарама-қарсы өтеді — ауданы жоқ).
function diagonalCorners(s: number): string {
  const a = (1 - s) * 100;
  const b = s * 100;
  return `polygon(0% 0%, ${a}% 0%, 0% ${a}%, 0% 0%, 100% 100%, 100% ${b}%, ${b}% 100%, 100% 100%)`;
}

type ViewTransitionDoc = Document & {
  startViewTransition?: (cb: () => Promise<void> | void) => { ready: Promise<void>; finished: Promise<void> };
};

function setThemeClasses(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark-theme', resolved === 'dark');
  root.classList.toggle('light-theme', resolved === 'light');
}

/**
 * Тақырыпты анимациямен ауыстыру: бүкіл бет бір кадр ретінде ауысады
 * (әр карта өз transition-ымен кешікпейді). View Transitions жоқ браузерде —
 * жай opacity әсері.
 */
function runThemeTransition(resolved: ResolvedTheme, update: () => void) {
  const root = document.documentElement;
  const doc = document as ViewTransitionDoc;

  // Элементтердің өз transition-дары ауысу кезінде өшеді
  root.classList.add('theme-switching');
  const done = () => requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));

  // Баптауларда «Тақырып ауысуы» анимациясы өшік (не құрылғы әлсіз) — бірден ауысады
  if (!isAnimationOn('global.themeTransition')) {
    flushSync(update);
    setThemeClasses(resolved);
    done();
    return;
  }

  if (!doc.startViewTransition) {
    const body = document.body;
    body.style.opacity = '0.7';
    body.style.transition = 'opacity 0.3s ease';
    flushSync(update);
    setThemeClasses(resolved);
    void root.offsetHeight;
    requestAnimationFrame(() => { body.style.opacity = '1'; });
    setTimeout(() => { body.style.transition = ''; }, 300);
    done();
    return;
  }

  // Ақ → қара: қара екі қарама-қарсы бұрыштан шығып, ортада түйіседі
  //   (ескі ақ кадр ортадағы диагональға қарай жиырылады).
  // Қара → ақ: ақ ортадан шығып, екі бұрышқа қарай жайылады.
  const toDark = resolved === 'dark';
  root.classList.toggle('vt-to-dark', toDark);
  root.classList.toggle('vt-to-light', !toDark);

  const transition = doc.startViewTransition(async () => {
    flushSync(update);
    setThemeClasses(resolved);
    // Monaco/xterm түстерін жаңартып үлгерсін. requestAnimationFrame-ді КҮТУГЕ
    // БОЛМАЙДЫ: View Transition кезінде кадр салынбайды, rAF 4 секундтық
    // таймаутқа дейін шақырылмай, анимация мүлде тоқтатылады.
    await new Promise<void>((r) => setTimeout(r, 0));
  });
  transition.ready.then(() => {
    // Екі бағытта да ЕСКІ кадр үстіде тұрып анимацияланады — артындағы бет
    // мәтіндерімен бірге көрінеді.
    // Ақ → қара: ескі (ақ) кадр ортадағы диагональ жолаққа жиырылады.
    // Қара → ақ: ескі (қара) кадр бұрыштарға қарай кішірейеді, ортадан ақ ашылады.
    root.animate(
      { clipPath: toDark ? [diagonalBand(1), diagonalBand(0)] : [diagonalCorners(0), diagonalCorners(1)] },
      {
        duration: 650,
        easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
        fill: 'both',
        pseudoElement: '::view-transition-old(root)',
      },
    );
  }).catch(() => {});
  const cleanup = () => {
    root.classList.remove('vt-to-dark', 'vt-to-light');
    done();
  };
  transition.finished.then(cleanup, cleanup);
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // Жаңа келген адамға — жүйе тақырыбы («auto»).
  // Бір рет кіріп, тақырыпты таңдаған адам келесіде сол тақырыпта қалады (шыққанда да өшпейді).
  const getInitialPreference = (): ThemePreference => {
    try {
      const saved = localStorage.getItem('theme-preference') as ThemePreference | null;
      if (saved && ['auto', 'light', 'dark'].includes(saved)) return saved;
      // Ескі нұсқадан қалған кілт — адам соңғы көрген фон; жаңа кілтке көшіреміз
      const oldTheme = localStorage.getItem('theme');
      localStorage.removeItem('theme');
      if (oldTheme === 'dark' || oldTheme === 'light') {
        localStorage.setItem('theme-preference', oldTheme);
        return oldTheme;
      }
    } catch { /* localStorage қолжетімсіз — жүйе тақырыбы */ }
    return 'auto';
  };

  const [preference, setPreference] = useState<ThemePreference>(getInitialPreference);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme(getInitialPreference()));

  // Алғашқы жүктелуде — анимациясыз, бірден
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    setThemeClasses(theme);
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem('theme-preference', preference); } catch { /* сақталмаса да жұмыс істейді */ }
  }, [preference]);

  const changePreference = useCallback((next: ThemePreference) => {
    const resolved = resolveTheme(next);
    runThemeTransition(resolved, () => {
      setPreference(next);
      setTheme(resolved);
    });
  }, []);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (preference !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = e.matches ? 'dark' : 'light';
      runThemeTransition(resolved, () => setTheme(resolved));
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [preference]);

  const setThemePreference = useCallback((pref: ThemePreference) => {
    changePreference(pref);
  }, [changePreference]);

  const toggleTheme = useCallback(() => {
    // Көрініп тұрған тақырыпқа қарама-қарсысына ауысады (auto болса да)
    changePreference(theme === 'light' ? 'dark' : 'light');
  }, [changePreference, theme]);

  return (
    <ThemeContext.Provider value={{ theme, preference, setThemePreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};