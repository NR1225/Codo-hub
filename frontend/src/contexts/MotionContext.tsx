import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { cachedProfile, measureProfile, quickProfile, DeviceProfile } from '../utils/deviceProfile';

/**
 * Анимацияларды басқару: әр беттің әр анимациясы бөлек қосылады/өшіріледі.
 *
 * Әдепкі мән («Авто») құрылғыға қарай шығады:
 *   - қуатты компьютер — бәрі қосулы;
 *   - телефон, планшет, ноутбук, орташа құрылғы — ауыр (medium/high) анимациялар өшік;
 *   - әлсіз құрылғы — ауыр (high) анимацияларды қосу мүмкін емес («құрылғы көтермейді»).
 * Пайдаланушы таңдауы localStorage-та сақталады.
 */

export type MotionCost = 'low' | 'medium' | 'high';
export type MotionGroup = 'global' | 'auth' | 'home' | 'chat' | 'codes' | 'notes' | 'vibecoding' | 'profile' | 'settings' | 'welcome';

export interface MotionDef {
  id: string;
  group: MotionGroup;
  cost: MotionCost;
  /** Өшірілгенде осы түбір ішіндегі CSS анимациялары мен transition-дар тоқтатылады */
  scope?: string;
}

export const MOTION_DEFS: MotionDef[] = [
  { id: 'global.themeTransition', group: 'global', cost: 'medium' },
  { id: 'auth.meteors', group: 'auth', cost: 'high' },
  { id: 'auth.parallax', group: 'auth', cost: 'high' },
  { id: 'auth.card', group: 'auth', cost: 'low', scope: '.landing-auth' },
  { id: 'home.ui', group: 'home', cost: 'low', scope: '.home-page' },
  { id: 'chat.ui', group: 'chat', cost: 'low', scope: '.cht-page' },
  { id: 'codes.ui', group: 'codes', cost: 'low', scope: '.codes-page' },
  { id: 'notes.ui', group: 'notes', cost: 'low', scope: '.nt-root' },
  { id: 'vibecoding.ui', group: 'vibecoding', cost: 'low', scope: '.vibe-root' },
  { id: 'profile.ui', group: 'profile', cost: 'low', scope: '.profile-page' },
  { id: 'settings.ui', group: 'settings', cost: 'low', scope: '.settings-page' },
  { id: 'welcome.ui', group: 'welcome', cost: 'medium', scope: '.welcome-page' },
];

export const MOTION_GROUPS: MotionGroup[] = ['global', 'auth', 'home', 'chat', 'codes', 'notes', 'vibecoding', 'profile', 'settings', 'welcome'];

const PREFS_KEY = 'motion-prefs-v1';

interface MotionPrefs {
  master: boolean;
  overrides: Record<string, boolean>;
}

function loadPrefs(): MotionPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { master: p.master !== false, overrides: p.overrides && typeof p.overrides === 'object' ? p.overrides : {} };
    }
  } catch { /* сақталған мән бұзылған — әдепкісін аламыз */ }
  return { master: true, overrides: {} };
}

const defById = (id: string) => MOTION_DEFS.find((d) => d.id === id);

export function isSupportedFor(profile: DeviceProfile, def: MotionDef): boolean {
  return !(profile.tier === 'low' && def.cost === 'high');
}

export function autoValueFor(profile: DeviceProfile, def: MotionDef): boolean {
  if (!isSupportedFor(profile, def)) return false;
  if (profile.reducedMotion) return false;
  if (profile.tier === 'high' && !profile.saveData) return true;
  // Телефон, ноутбук, әлсіз/орташа құрылғы — тек жеңіл анимациялар
  return def.cost === 'low';
}

function resolve(profile: DeviceProfile, prefs: MotionPrefs, def: MotionDef): boolean {
  if (!prefs.master) return false;
  if (!isSupportedFor(profile, def)) return false;
  const o = prefs.overrides[def.id];
  return o === undefined ? autoValueFor(profile, def) : o;
}

// React-тан тыс код (мысалы, тақырып ауысу анимациясы) үшін ағымдағы күй
let current: { profile: DeviceProfile; prefs: MotionPrefs } | null = null;

export function isAnimationOn(id: string): boolean {
  const def = defById(id);
  if (!def) return true;
  if (!current) {
    const profile = cachedProfile() ?? quickProfile();
    return resolve(profile, loadPrefs(), def);
  }
  return resolve(current.profile, current.prefs, def);
}

const SPIN_SAFE = ':not(.fa-spin):not([class*="spin"]):not([class*="loader"])';

function buildCss(disabled: MotionDef[], master: boolean): string {
  const block = '{ animation: none !important; transition: none !important; }';
  if (!master) {
    return `html *${SPIN_SAFE}, html *${SPIN_SAFE}::before, html *${SPIN_SAFE}::after ${block}\n`
      + 'html::view-transition-old(root), html::view-transition-new(root) { animation: none !important; }';
  }
  return disabled
    .filter((d) => d.scope)
    .map((d) => {
      const s = d.scope!;
      return `${s}, ${s} *${SPIN_SAFE}, ${s} *${SPIN_SAFE}::before, ${s} *${SPIN_SAFE}::after ${block}`;
    })
    .join('\n');
}

interface MotionContextValue {
  profile: DeviceProfile;
  checking: boolean;
  master: boolean;
  setMaster: (on: boolean) => void;
  isOn: (id: string) => boolean;
  isSupported: (id: string) => boolean;
  autoValue: (id: string) => boolean;
  override: (id: string) => boolean | undefined;
  setOverride: (id: string, on: boolean | null) => void;
  resetAll: () => void;
  recheck: () => Promise<void>;
}

const MotionContext = createContext<MotionContextValue | undefined>(undefined);

export const MotionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [profile, setProfile] = useState<DeviceProfile>(() => cachedProfile() ?? quickProfile());
  const [checking, setChecking] = useState(false);
  const [prefs, setPrefs] = useState<MotionPrefs>(loadPrefs);

  current = { profile, prefs };

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setProfile(await measureProfile());
    } finally {
      setChecking(false);
    }
  }, []);

  // Кэш жоқ (не ескі) болса — бет жүктеліп болған соң толық тексеру
  useEffect(() => {
    if (profile.measuredAt) return;
    const run = () => { void recheck(); };
    const t = setTimeout(run, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Жүйедегі «қозғалысты азайту» баптауы өзгерсе
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => setProfile((p) => ({ ...p, reducedMotion: e.matches }));
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* сақталған мән бұзылған — әдепкісін аламыз */ }
  }, [prefs]);

  // Өшірілген беттердің CSS анимацияларын тоқтататын ережелер
  useEffect(() => {
    const disabled = MOTION_DEFS.filter((d) => !resolve(profile, prefs, d));
    let el = document.getElementById('motion-rules') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'motion-rules';
      document.head.appendChild(el);
    }
    el.textContent = buildCss(disabled, prefs.master);
    document.documentElement.classList.toggle('motion-off', !prefs.master);
  }, [profile, prefs]);

  const value = useMemo<MotionContextValue>(() => {
    const def = (id: string) => defById(id)!;
    return {
      profile,
      checking,
      master: prefs.master,
      setMaster: (on) => setPrefs((p) => ({ ...p, master: on })),
      isOn: (id) => (defById(id) ? resolve(profile, prefs, def(id)) : true),
      isSupported: (id) => (defById(id) ? isSupportedFor(profile, def(id)) : true),
      autoValue: (id) => (defById(id) ? autoValueFor(profile, def(id)) : true),
      override: (id) => prefs.overrides[id],
      setOverride: (id, on) => setPrefs((p) => {
        const overrides = { ...p.overrides };
        // Авто мәнмен бірдей болса — бөлек таңдау сақталмайды, «Авто» болып қалады
        if (on === null || (defById(id) && on === autoValueFor(profile, def(id)))) delete overrides[id];
        else overrides[id] = on;
        return { ...p, overrides };
      }),
      resetAll: () => setPrefs({ master: true, overrides: {} }),
      recheck,
    };
  }, [profile, prefs, checking, recheck]);

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
};

export function useMotion(): MotionContextValue {
  const ctx = useContext(MotionContext);
  if (!ctx) throw new Error('useMotion must be used within a MotionProvider');
  return ctx;
}

/** Бір анимацияның қазір қосулы екенін қайтарады. */
export function useAnimation(id: string): boolean {
  return useMotion().isOn(id);
}
