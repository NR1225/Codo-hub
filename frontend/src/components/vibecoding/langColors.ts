// Файл түріне қарай кішкентай жарық нүктенің түсі — монохром дизайндағы
// жалғыз түсті белгі (эксплорер мен қойындыларда бірдей)
const LANG_COLORS: Record<string, string> = {
  javascript: '#f7df1e',
  typescript: '#4f9cf9',
  python: '#ffd43b',
  html: '#f06529',
  css: '#a78bfa',
  json: '#a3a3a3',
  markdown: '#e5e5e5',
  java: '#ed8b00',
  cpp: '#659ad2',
  c: '#a8b9cc',
  rust: '#dea584',
  go: '#00add8',
  php: '#8892bf',
  shell: '#89e015',
  sql: '#e38c00',
};

export function langColor(lang: string): string {
  return LANG_COLORS[lang] ?? '#737373';
}

// Файл кеңейтпесі (белгіше ішіндегі қысқа мәтін)
export function fileExt(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return ext.slice(0, 4).toUpperCase();
}
