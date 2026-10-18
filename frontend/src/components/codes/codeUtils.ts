import { CodeFile } from '../../utils/api';

/* Кодтар беті мен Кодтар тізімі бетіне ортақ көмекші функциялар */

export type SortOption = 'newest' | 'oldest' | 'title' | 'author';
export type ViewMode = 'grid' | 'list';

export const VIEW_STORAGE_KEY = 'kh-codes-view';
const SNIPPET_LINES = 7;

export const SORT_OPTIONS: { value: SortOption; labelKey: string }[] = [
  { value: 'newest', labelKey: 'home.newest' },
  { value: 'oldest', labelKey: 'home.oldest' },
  { value: 'title', labelKey: 'home.byTitle' },
  { value: 'author', labelKey: 'home.byAuthor' },
];

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

export function saveViewMode(view: ViewMode) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // localStorage қолжетімсіз болса — елемеу
  }
}

export function compareCodes(sortBy: SortOption) {
  return (a: CodeFile, b: CodeFile) => {
    switch (sortBy) {
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case 'title':
        return (a.title || '').localeCompare(b.title || '');
      case 'author':
        return (a.author || '').localeCompare(b.author || '');
      default:
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    }
  };
}

// Папка құрылымы (JSON) болса, үзінді ретінде көрсетпейміз
export function codeSnippet(code: CodeFile): string {
  if (code.isFolder || !code.content) return '';
  const trimmed = code.content.trim();
  if (trimmed.startsWith('{') && trimmed.includes('"structure"')) return '';
  return trimmed.split('\n').slice(0, SNIPPET_LINES).join('\n').slice(0, 600);
}

export function folderEntries(code: CodeFile) {
  if (!code.isFolder || !code.folderStructure) return { files: 0, folders: 0, names: [] as { name: string; type: string }[] };
  const values = Object.values(code.folderStructure);
  return {
    files: values.filter((v) => v.type === 'file').length,
    folders: values.filter((v) => v.type === 'folder').length,
    names: values
      .slice()
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1))
      .slice(0, 5)
      .map((v) => ({ name: v.name, type: v.type })),
  };
}

export const isNetworkError = (message: string) =>
  message.includes('timeout') || message.includes('Failed to fetch') || message.includes('қосылу');
