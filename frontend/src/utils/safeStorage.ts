/* localStorage-қа жазу: жад шегі (~5 МБ) толса — қайта алуға болатын кэшті тазалап, қайталаймыз.
   Маңыздысы — кіру токені жад толғаны үшін жазылмай, кіру үзіліп қалмауы керек. */

const VIBECODING_KEY = 'vibecoding_state';

export function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | null;
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

/** Vibecoding-ке көшірілген жүктелген жобалар (repo-…) — кодтар бетінен қайта ашылады */
function dropRepoProjects(): boolean {
  const raw = localStorage.getItem(VIBECODING_KEY);
  if (!raw) return false;
  try {
    const state = JSON.parse(raw);
    if (!Array.isArray(state?.projects)) return false;
    const kept = state.projects.filter((p: { id?: string }) => !String(p?.id).startsWith('repo-'));
    if (kept.length === state.projects.length) return false;
    if (kept.length === 0) {
      // Бос күй сақталмайды — келесі ашылғанда әдепкі жоба / сервердегілер жүктеледі
      localStorage.removeItem(VIBECODING_KEY);
      return true;
    }
    state.projects = kept;
    if (!kept.some((p: { id: string }) => p.id === state.activeProjectId)) state.activeProjectId = kept[0]?.id ?? null;
    state.openFileIds = [];
    state.activeFileId = null;
    localStorage.setItem(VIBECODING_KEY, JSON.stringify(state));
    return true;
  } catch {
    localStorage.removeItem(VIBECODING_KEY);
    return true;
  }
}

/** Серверге синхрондалған Vibecoding күйі (ownerId бар) — кіргенде серверден қайта жүктеледі */
function dropSyncedVibecoding(): boolean {
  const raw = localStorage.getItem(VIBECODING_KEY);
  if (!raw) return false;
  try {
    if (!JSON.parse(raw)?.ownerId) return false;
  } catch { /* бұзылған жазба — өшіре береміз */ }
  localStorage.removeItem(VIBECODING_KEY);
  return true;
}

/** imageStorage-тың localStorage-тағы суреттері (аватар, фон) — серверден қайта алынады */
function dropImageCache(): boolean {
  let freed = false;
  for (const key of Object.keys(localStorage)) {
    if (key.endsWith('_storage') && localStorage.getItem(key) === 'localStorage') {
      localStorage.removeItem(key.slice(0, -'_storage'.length));
      localStorage.removeItem(key);
      freed = true;
    }
  }
  return freed;
}

const EVICTIONS = [dropRepoProjects, dropSyncedVibecoding, dropImageCache];

/** Жазу сәтті болса — true. Жад толса кэшті біртіндеп тазалап қайталайды; мүлде болмаса — false. */
export function setItemSafe(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaError(err)) return false;
  }
  for (const evict of EVICTIONS) {
    try {
      if (!evict()) continue;
      localStorage.setItem(key, value);
      console.warn(`localStorage толы болды — кэш тазаланып, «${key}» сақталды`);
      return true;
    } catch (err) {
      if (!isQuotaError(err)) return false;
    }
  }
  console.warn(`localStorage толы — «${key}» сақталмады`);
  return false;
}
