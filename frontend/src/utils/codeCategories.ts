import { CodeFile } from './api';

/* Кодтар тізімінің бөлімдері — жүктеу кезінде таңдалған категория бойынша.
   Таңдалған мән `category:<мән>` тегі ретінде сақталады (UploadModal). */

export type CategoryKey = 'ai' | 'mobile' | 'web' | 'desktop' | 'game' | 'api' | 'database' | 'devops' | 'other';

export const CATEGORY_TAG_PREFIX = 'category:';

// Бөлімдердің реті: «Басқа» әрқашан ең соңында
export const CATEGORIES: { key: CategoryKey; labelKey: string; values: string[] }[] = [
  {
    key: 'ai',
    labelKey: 'uploadModal.categoryAI',
    values: ['machine-learning', 'natural-language-processing', 'computer-vision', 'ai-applications'],
  },
  { key: 'mobile', labelKey: 'uploadModal.categoryMobile', values: ['ios-app', 'android-app', 'cross-platform-app', 'mobile-game'] },
  { key: 'web', labelKey: 'uploadModal.categoryOtherOption1', values: ['web-app'] },
  { key: 'desktop', labelKey: 'uploadModal.categoryOtherOption2', values: ['desktop-app'] },
  { key: 'game', labelKey: 'uploadModal.categoryOtherOption3', values: ['game'] },
  { key: 'api', labelKey: 'uploadModal.categoryOtherOption4', values: ['api'] },
  { key: 'database', labelKey: 'uploadModal.categoryOtherOption5', values: ['database'] },
  { key: 'devops', labelKey: 'uploadModal.categoryOtherOption6', values: ['devops'] },
  { key: 'other', labelKey: 'uploadModal.categoryOtherOption7', values: ['other'] },
];

const BY_VALUE = new Map(CATEGORIES.flatMap((c) => c.values.map((v) => [v, c.key] as const)));

export function categoryFromSlug(slug: string | null): CategoryKey | null {
  return CATEGORIES.find((c) => c.key === slug)?.key ?? null;
}

// Таңдалған категориялар (жоба бірнеше бағытта болуы мүмкін): алдымен тегтерден, ескі
// жүктемелерде — сипаттама орнына жазылған мәннен. Категориясыз код «Басқа» бөліміне түседі.
export function getCategories(code: CodeFile): CategoryKey[] {
  const values = (code.tags ?? [])
    .filter((t) => t.startsWith(CATEGORY_TAG_PREFIX))
    .map((t) => t.slice(CATEGORY_TAG_PREFIX.length));
  if (!values.length && code.description) values.push(code.description.trim());
  const keys = [...new Set(values.map((v) => BY_VALUE.get(v)).filter((k): k is CategoryKey => !!k))];
  return keys.length ? keys : ['other'];
}

export const getCategory = (code: CodeFile): CategoryKey => getCategories(code)[0];

/* Жобаның тілдері: code.language — негізгісі, қалғандары `lang:<тіл>` тегі ретінде */
export const LANGUAGE_TAG_PREFIX = 'lang:';

export function getLanguages(code: CodeFile): string[] {
  const extra = (code.tags ?? []).filter((t) => t.startsWith(LANGUAGE_TAG_PREFIX)).map((t) => t.slice(LANGUAGE_TAG_PREFIX.length));
  const main = code.language?.trim();
  return [...new Set([...(main ? [main] : []), ...extra])];
}
