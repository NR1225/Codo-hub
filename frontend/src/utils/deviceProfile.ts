/**
 * Құрылғының анимацияны қаншалықты «көтеретінін» анықтау.
 *
 * Белгілер: құрылғы түрі (телефон/планшет/ноутбук/компьютер), CPU ядролары,
 * жады, GPU (бағдарламалық рендер — ең әлсіз), экранның нақты FPS-і,
 * «қозғалысты азайту» және «трафикті үнемдеу» баптаулары.
 *
 * Нәтиже — tier:
 *   high   — барлық анимация әдепкіде қосулы
 *   medium — телефон, ноутбук, орташа құрылғы: ауыр анимациялар әдепкіде өшік
 *   low    — әлсіз құрылғы: ауыр анимацияларды қосу мүмкін емес
 */

export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'desktop';
export type DeviceTier = 'high' | 'medium' | 'low';

export interface DeviceProfile {
  kind: DeviceKind;
  tier: DeviceTier;
  cores: number | null;
  memory: number | null;
  gpu: string | null;
  softwareGpu: boolean;
  fps: number | null;
  reducedMotion: boolean;
  saveData: boolean;
  measuredAt: number;
}

const CACHE_KEY = 'motion-device-v1';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

type NavigatorExtra = Navigator & {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
  connection?: { saveData?: boolean };
  getBattery?: () => Promise<{ charging: boolean; level: number; chargingTime: number; dischargingTime: number }>;
};

const nav = (): NavigatorExtra => navigator as NavigatorExtra;

function readGpu(): { name: string | null; software: boolean } {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return { name: null, software: true };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const software = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(name);
    return { name, software };
  } catch {
    return { name: null, software: false };
  }
}

function baseKind(): DeviceKind {
  const n = nav();
  const ua = n.userAgent || '';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shortSide = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  // iPadOS өзін Mac деп таныстырады — тек сенсорымен ажыратылады
  const iPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && n.maxTouchPoints > 1);
  if (n.userAgentData?.mobile || /iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i.test(ua)) return 'phone';
  if (iPad || /Android/i.test(ua) || (coarse && shortSide >= 600)) return 'tablet';
  if (coarse && shortSide < 600) return 'phone';
  return 'desktop';
}

/** Батареясы бар компьютер — ноутбук. Компьютерде API «әрқашан 100%, зарядталып тұр» дейді. */
async function hasBattery(): Promise<boolean> {
  try {
    const getBattery = nav().getBattery;
    if (!getBattery) return false;
    const b = await getBattery.call(navigator);
    const desktopSignature = b.charging && b.level === 1 && b.chargingTime === 0 && !Number.isFinite(b.dischargingTime);
    return !desktopSignature;
  } catch {
    return false;
  }
}

/** Экран кадрларының медиана жиілігі (~0.7 сек). Бет жасырын болса — null. */
function measureFps(): Promise<number | null> {
  return new Promise((resolve) => {
    if (document.visibilityState !== 'visible' || typeof requestAnimationFrame !== 'function') {
      resolve(null);
      return;
    }
    const deltas: number[] = [];
    let last = 0;
    let started = 0;
    const timeout = setTimeout(() => finish(), 2000);
    const finish = () => {
      clearTimeout(timeout);
      if (deltas.length < 10) { resolve(null); return; }
      deltas.sort((a, b) => a - b);
      const median = deltas[Math.floor(deltas.length / 2)];
      resolve(Math.round(1000 / median));
    };
    const tick = (ts: number) => {
      if (!started) started = ts;
      if (last) deltas.push(ts - last);
      last = ts;
      if (ts - started < 700) requestAnimationFrame(tick);
      else finish();
    };
    requestAnimationFrame(tick);
  });
}

function computeTier(p: Omit<DeviceProfile, 'tier' | 'measuredAt'>): DeviceTier {
  const { kind, cores, memory, softwareGpu, fps } = p;
  if (softwareGpu) return 'low';
  if (cores !== null && cores <= 2) return 'low';
  if (memory !== null && memory <= 2) return 'low';
  if (fps !== null && fps < 28) return 'low';
  if (kind !== 'desktop') return 'medium';
  if (cores !== null && cores <= 4) return 'medium';
  if (memory !== null && memory <= 4) return 'medium';
  if (fps !== null && fps < 50) return 'medium';
  return 'high';
}

/** Жылдам, синхронды бағалау — кэш жоқ кезде бірінші кадрда қолданылады. */
export function quickProfile(): DeviceProfile {
  const n = nav();
  const gpu = readGpu();
  const partial = {
    kind: baseKind(),
    cores: n.hardwareConcurrency || null,
    memory: n.deviceMemory ?? null,
    gpu: gpu.name,
    softwareGpu: gpu.software,
    fps: null,
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    saveData: !!n.connection?.saveData,
  };
  return { ...partial, tier: computeTier(partial), measuredAt: 0 };
}

/** Толық тексеру: батарея (ноутбук) және FPS өлшеуі бар. */
export async function measureProfile(): Promise<DeviceProfile> {
  const quick = quickProfile();
  let kind = quick.kind;
  if (kind === 'desktop' && (await hasBattery())) kind = 'laptop';
  const fps = await measureFps();
  const partial = { ...quick, kind, fps };
  const profile: DeviceProfile = { ...partial, tier: computeTier(partial), measuredAt: Date.now() };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(profile)); } catch { /* localStorage қолжетімсіз */ }
  return profile;
}

export function cachedProfile(): DeviceProfile | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as DeviceProfile;
    if (!p.measuredAt || Date.now() - p.measuredAt > CACHE_TTL) return null;
    // «Қозғалысты азайту» кез келген уақытта өзгеруі мүмкін — әрқашан жаңасын аламыз
    p.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    return p;
  } catch {
    return null;
  }
}
