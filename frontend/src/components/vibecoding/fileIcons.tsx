import React from 'react';

/* VS Code (Seti / Material Icon Theme) сияқты файл мен папка белгішелері:
   файл түрін кеңейтпесі мен атауынан, папка түрін атауынан анықтаймыз.
   Эксплорер, қойындылар және командалар палитрасы осы жиынды қолданады. */

type Glyph = 'react' | 'git' | 'gear' | 'image' | 'lock' | 'npm' | 'docker' | 'info' | 'db' | 'terminal' | 'text' | 'key' | 'file';

interface FileSpec {
  color: string;
  /** Қысқа мәтін белгі ("JS", "TS", "{}") — немесе glyph */
  label?: string;
  glyph?: Glyph;
}

// Толық атау бойынша (кеңейтпеден басым)
const BY_NAME: Record<string, FileSpec> = {
  'package.json': { color: '#e8274b', glyph: 'npm' },
  'package-lock.json': { color: '#8a8a8a', glyph: 'npm' },
  'readme.md': { color: '#42a5f5', glyph: 'info' },
  'license': { color: '#d4b106', glyph: 'text' },
  'license.md': { color: '#d4b106', glyph: 'text' },
  '.gitignore': { color: '#f4511e', glyph: 'git' },
  '.gitattributes': { color: '#f4511e', glyph: 'git' },
  '.gitmodules': { color: '#f4511e', glyph: 'git' },
  'dockerfile': { color: '#2496ed', glyph: 'docker' },
  'docker-compose.yml': { color: '#2496ed', glyph: 'docker' },
  'docker-compose.yaml': { color: '#2496ed', glyph: 'docker' },
  '.dockerignore': { color: '#2496ed', glyph: 'docker' },
  'yarn.lock': { color: '#2c8ebb', glyph: 'lock' },
  'pnpm-lock.yaml': { color: '#f69220', glyph: 'lock' },
  'requirements.txt': { color: '#ffd43b', glyph: 'text' },
  'makefile': { color: '#9e9e9e', glyph: 'terminal' },
};

// Кеңейтпе бойынша
const BY_EXT: Record<string, FileSpec> = {
  js: { color: '#f7df1e', label: 'JS' },
  mjs: { color: '#f7df1e', label: 'JS' },
  cjs: { color: '#f7df1e', label: 'JS' },
  ts: { color: '#3b8eea', label: 'TS' },
  mts: { color: '#3b8eea', label: 'TS' },
  jsx: { color: '#61dafb', glyph: 'react' },
  tsx: { color: '#3b8eea', glyph: 'react' },
  html: { color: '#f06529', label: '<>' },
  htm: { color: '#f06529', label: '<>' },
  css: { color: '#42a5f5', label: '#' },
  scss: { color: '#f06292', label: '#' },
  sass: { color: '#f06292', label: '#' },
  less: { color: '#5c6bc0', label: '#' },
  json: { color: '#fbc02d', label: '{}' },
  jsonc: { color: '#fbc02d', label: '{}' },
  md: { color: '#42a5f5', label: 'M↓' },
  mdx: { color: '#f9ac00', label: 'M↓' },
  py: { color: '#ffd43b', label: 'py' },
  ipynb: { color: '#f57c00', label: 'py' },
  java: { color: '#ed8b00', label: 'J' },
  kt: { color: '#a97bff', label: 'K' },
  c: { color: '#a8b9cc', label: 'C' },
  h: { color: '#a074c4', label: 'h' },
  cpp: { color: '#659ad2', label: 'C++' },
  cc: { color: '#659ad2', label: 'C++' },
  hpp: { color: '#a074c4', label: 'h' },
  cs: { color: '#9b4f96', label: 'C#' },
  go: { color: '#00add8', label: 'GO' },
  rs: { color: '#dea584', label: 'RS' },
  php: { color: '#8892bf', label: 'php' },
  rb: { color: '#cc342d', label: 'rb' },
  swift: { color: '#f05138', label: 'sw' },
  dart: { color: '#40c4ff', label: 'dt' },
  vue: { color: '#41b883', label: 'V' },
  svelte: { color: '#ff3e00', label: 'S' },
  sh: { color: '#89e015', glyph: 'terminal' },
  bash: { color: '#89e015', glyph: 'terminal' },
  zsh: { color: '#89e015', glyph: 'terminal' },
  ps1: { color: '#5391fe', glyph: 'terminal' },
  bat: { color: '#c1f12e', glyph: 'terminal' },
  sql: { color: '#e38c00', glyph: 'db' },
  db: { color: '#e38c00', glyph: 'db' },
  sqlite: { color: '#e38c00', glyph: 'db' },
  prisma: { color: '#5a67d8', glyph: 'db' },
  yml: { color: '#cb4b8f', label: 'Y' },
  yaml: { color: '#cb4b8f', label: 'Y' },
  toml: { color: '#9e9e9e', glyph: 'gear' },
  ini: { color: '#9e9e9e', glyph: 'gear' },
  cfg: { color: '#9e9e9e', glyph: 'gear' },
  conf: { color: '#9e9e9e', glyph: 'gear' },
  xml: { color: '#e37933', label: '<>' },
  svg: { color: '#ffb13b', glyph: 'image' },
  png: { color: '#a074c4', glyph: 'image' },
  jpg: { color: '#a074c4', glyph: 'image' },
  jpeg: { color: '#a074c4', glyph: 'image' },
  gif: { color: '#a074c4', glyph: 'image' },
  webp: { color: '#a074c4', glyph: 'image' },
  ico: { color: '#a074c4', glyph: 'image' },
  txt: { color: '#a3a3a3', glyph: 'text' },
  log: { color: '#a3a3a3', glyph: 'text' },
  csv: { color: '#89e051', glyph: 'text' },
  lock: { color: '#9e9e9e', glyph: 'lock' },
  env: { color: '#fbc02d', glyph: 'key' },
};

const DEFAULT_FILE: FileSpec = { color: '#9e9e9e', glyph: 'file' };

export function fileSpec(fileName: string): FileSpec {
  const name = fileName.toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name === '.env' || name.startsWith('.env.')) return BY_EXT.env;
  if (name.endsWith('.d.ts')) return { color: '#3b8eea', label: 'D' };
  // vite.config.ts, tailwind.config.js, eslint.config.mjs — баптау файлдары
  if (/\.config\.[a-z]+$/.test(name) || /^tsconfig.*\.json$/.test(name) || /^\.(eslintrc|prettierrc|editorconfig|babelrc)/.test(name)) {
    return { color: '#9e9e9e', glyph: 'gear' };
  }
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  return BY_EXT[ext] ?? DEFAULT_FILE;
}

const GLYPHS: Record<Glyph, React.ReactNode> = {
  react: (
    <>
      <ellipse cx="8" cy="8" rx="6.6" ry="2.6" />
      <ellipse cx="8" cy="8" rx="6.6" ry="2.6" transform="rotate(60 8 8)" />
      <ellipse cx="8" cy="8" rx="6.6" ry="2.6" transform="rotate(120 8 8)" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  git: (
    <>
      <path d="M8 1.8 14.2 8 8 14.2 1.8 8Z" fill="currentColor" stroke="none" opacity="0.9" />
      <path d="M6.2 5v6M6.2 6.2l3.4 3.2" stroke="#0e0e0e" strokeWidth="1.3" />
      <circle cx="6.2" cy="11" r="1.1" fill="#0e0e0e" stroke="none" />
      <circle cx="9.7" cy="9.5" r="1.1" fill="#0e0e0e" stroke="none" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3" />
    </>
  ),
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="5.6" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
      <path d="m14 10.5-3.2-3.2L4.5 13" />
    </>
  ),
  lock: (
    <>
      <rect x="3.2" y="7" width="9.6" height="7" rx="1.5" />
      <path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7" />
    </>
  ),
  npm: (
    <>
      <rect x="1.8" y="4.5" width="12.4" height="7" rx="0.8" fill="currentColor" stroke="none" />
      <path d="M4 10V6.5h2.4V10M5.2 6.5V10M8 10V6.5h2.4v2.7H9.2" stroke="#fff" strokeWidth="1.1" />
    </>
  ),
  docker: (
    <>
      <path d="M1.8 8.6h11c.6 0 1.4-.6 1.7-1.6.6.2 1 .6 1 .6-.6 1.2-1.6 1.6-2 1.6-.9 2.4-3.4 4-6.6 4-3.2 0-4.8-2-5.1-4.6Z" fill="currentColor" stroke="none" />
      <path d="M3.4 6.2h1.8v1.8H3.4zM5.8 6.2h1.8v1.8H5.8zM8.2 6.2H10v1.8H8.2zM5.8 3.8h1.8v1.8H5.8zM8.2 3.8H10v1.8H8.2z" fill="currentColor" stroke="none" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v4" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  db: (
    <>
      <ellipse cx="8" cy="4" rx="5" ry="1.9" />
      <path d="M3 4v8c0 1 2.2 1.9 5 1.9s5-.9 5-1.9V4M3 8c0 1 2.2 1.9 5 1.9S13 9 13 8" />
    </>
  ),
  terminal: (
    <>
      <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" />
      <path d="m4.6 6.2 2 1.8-2 1.8M8.4 10h3" />
    </>
  ),
  text: (
    <>
      <path d="M9.5 1.8H4.2a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.3Z" />
      <path d="M5.4 8h5.2M5.4 10.6h3.6" />
    </>
  ),
  key: (
    <>
      <circle cx="5.4" cy="10.6" r="2.8" />
      <path d="m7.4 8.6 6-6M11.4 4.6l1.6 1.6M9.8 6.2l1.2 1.2" />
    </>
  ),
  file: (
    <>
      <path d="M9.5 1.8H4.2a1.2 1.2 0 0 0-1.2 1.2v10a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V5.3Z" />
      <path d="M9.5 1.8v3.5H13" />
    </>
  ),
};

export const FileTypeIcon: React.FC<{ name: string; size?: number }> = ({ name, size = 19 }) => {
  const spec = fileSpec(name);
  const label = spec.label;
  return (
    <svg
      className="vx-ficon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: spec.color }}
      aria-hidden="true"
    >
      {label ? (
        <text
          x="8"
          y="8.6"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          stroke="none"
          fontFamily="'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"
          fontWeight="800"
          fontSize={label.length >= 3 ? 7.2 : label.length === 2 ? 8.8 : 11.5}
          letterSpacing={label.length >= 2 ? -0.5 : 0}
        >
          {label}
        </text>
      ) : (
        GLYPHS[spec.glyph ?? 'file']
      )}
    </svg>
  );
};

// ─── Папкалар ─────────────────────────────────────────────────────

const FOLDER_GROUPS: [string, string[]][] = [
  ['#66bb6a', ['src', 'source', 'app']],
  ['#ffca28', ['components', 'component', 'ui', 'widgets', 'layouts', 'layout']],
  ['#ef5350', ['pages', 'views', 'screens', 'routes', 'router']],
  ['#42a5f5', ['public', 'static', 'dist', 'build', 'out', 'www']],
  ['#ffa726', ['assets', 'images', 'img', 'icons', 'media', 'fonts', 'audio', 'video']],
  ['#ec407a', ['styles', 'style', 'css', 'scss', 'theme', 'themes']],
  ['#26a69a', ['utils', 'util', 'lib', 'libs', 'helpers', 'shared', 'common', 'core']],
  ['#7e57c2', ['hooks', 'composables']],
  ['#ab47bc', ['api', 'services', 'service', 'server', 'backend', 'client']],
  ['#78909c', ['config', 'configs', 'settings', '.vscode', '.github', 'env']],
  ['#9ccc65', ['tests', 'test', '__tests__', 'spec', 'e2e', 'cypress']],
  ['#29b6f6', ['docs', 'doc', 'documentation']],
  ['#ff7043', ['models', 'model', 'types', 'interfaces', 'schemas', 'schema', 'entities', 'domain', 'db', 'database', 'migrations', 'prisma']],
  ['#5c6bc0', ['controllers', 'controller', 'middleware', 'middlewares', 'handlers', 'application', 'usecases']],
  ['#8d6e63', ['store', 'stores', 'state', 'redux', 'context', 'contexts', 'providers']],
  ['#8bc34a', ['scripts', 'bin', 'tools', 'infrastructure']],
  ['#26c6da', ['i18n', 'locales', 'lang', 'translations', 'presentation']],
  ['#616161', ['node_modules', '.git', 'vendor', '.cache']],
];

const FOLDER_COLORS = new Map<string, string>(
  FOLDER_GROUPS.flatMap(([color, names]) => names.map((n) => [n, color] as [string, string]))
);

const DEFAULT_FOLDER = '#90a4ae';

export function folderColor(name: string): string {
  return FOLDER_COLORS.get(name.toLowerCase()) ?? DEFAULT_FOLDER;
}

export const FolderTypeIcon: React.FC<{ name: string; open?: boolean; size?: number }> = ({ name, open, size = 19 }) => (
  <svg
    className="vx-ficon"
    width={size}
    height={size}
    viewBox="0 0 16 16"
    style={{ color: folderColor(name) }}
    aria-hidden="true"
  >
    {open ? (
      <>
        <path d="M1.5 12.5V3.6a1.1 1.1 0 0 1 1.1-1.1h3.5l1.5 1.6h5.2a1.1 1.1 0 0 1 1.1 1.1V6.4H4.4a1.3 1.3 0 0 0-1.2.9Z" fill="currentColor" opacity="0.55" />
        <path d="M1.5 12.6 3.4 7.2a1.1 1.1 0 0 1 1-.8h10.2a.7.7 0 0 1 .66.92l-1.7 5a1.1 1.1 0 0 1-1 .78H2.3a.8.8 0 0 1-.8-.5Z" fill="currentColor" />
      </>
    ) : (
      <>
        <path d="M1.5 3.6a1.1 1.1 0 0 1 1.1-1.1h3.5l1.5 1.6h5.8a1.1 1.1 0 0 1 1.1 1.1v7.2a1.1 1.1 0 0 1-1.1 1.1H2.6a1.1 1.1 0 0 1-1.1-1.1Z" fill="currentColor" />
        <path d="M1.5 5.8h13" stroke="#000" strokeOpacity="0.25" strokeWidth="1" />
      </>
    )}
  </svg>
);
