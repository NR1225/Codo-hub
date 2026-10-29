/* Жобалар бетіне жүктелетін файлдардың ережесі — backend/utils/upload_rules.py-мен бірдей.
   Код өтеді; кэш/қоқыс (node_modules, __pycache__, .git…) серверге мүлде жіберілмейді,
   құпия (.env, кілттер) мен бинарлы (.exe, .dll…) файлдар өткізіліп, қолданушыға айтылады. */

export type UploadSkip = 'junk' | 'secret' | 'blocked';

const JUNK_DIRS = new Set([
  'node_modules', 'bower_components', 'jspm_packages',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox', '.ipynb_checkpoints',
  '.venv', 'venv', '.git', '.svn', '.hg',
  '.next', '.nuxt', '.svelte-kit', '.angular', '.expo', '.parcel-cache', '.turbo', '.vercel',
  '.cache', '.gradle', '.dart_tool', '.idea', 'coverage', '.nyc_output',
  'dist', 'build', 'out', 'target', 'obj', '.output',
  'vendor', 'site-packages', '.eggs', '.pnpm-store', '.yarn', 'pods', 'deriveddata',
  '.vs', '.vscode', '.terraform', '.serverless', '.docusaurus', '.sass-cache',
  'htmlcov', '.hypothesis', '__macosx',
]);
// Аты осылармен аяқталатын папкалар да қоқыс (Python пакет метадеректері)
const JUNK_DIR_SUFFIXES = ['.egg-info', '.dist-info'];

const JUNK_FILES = new Set([
  '.ds_store', 'thumbs.db', 'desktop.ini', 'npm-debug.log', 'yarn-error.log', '.eslintcache', '.coverage',
  // Пакет менеджерлерінің lock-файлдары — код емес, тәуелділіктер тізімінің автогенерациясы
  'package-lock.json', '.package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock',
  'poetry.lock', 'pipfile.lock', 'pdm.lock', 'uv.lock', 'composer.lock', 'cargo.lock', 'gemfile.lock',
  'go.sum', 'packages.lock.json', 'pubspec.lock', 'podfile.lock', '.pnp.cjs', '.pnp.loader.mjs',
]);
const JUNK_EXTENSIONS = new Set([
  '.pyc', '.pyo', '.pyd', '.log', '.swp', '.swo', '.tmp', '.bak', '.orig', '.tsbuildinfo', '.map', '.lock', '.pdb',
  // Архивтер мен пакеттер
  '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.rar', '.7z', '.whl', '.egg', '.nupkg', '.gem', '.vsix', '.crx', '.iso',
  // Қаріптер, медиа, құжаттар — код емес
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.mp4', '.webm', '.mov', '.avi', '.mkv',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.psd', '.ai', '.sketch', '.fig',
]);
// Минификацияланған/бандл кітапханалар — бөтен пакеттің көшірмесі
const JUNK_NAME_SUFFIXES = ['.min.js', '.min.mjs', '.min.css', '.bundle.js', '.chunk.js'];

const SECRET_FILES = new Set([
  '.env', '.htpasswd', '.npmrc', '.pypirc', '.netrc', '.git-credentials',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  // Firebase / Google Cloud кілттері
  'serviceaccountkey.json', 'credentials.json', 'client_secret.json',
]);
const ENV_TEMPLATE_SUFFIXES = new Set(['example', 'sample', 'template', 'dist', 'defaults']);
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.kdbx']);

const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.jar', '.msi', '.dmg', '.app',
  '.deb', '.rpm', '.pkg', '.apk', '.bin', '.dll', '.so', '.dylib', '.sys', '.drv', '.ocx',
  '.cpl', '.class', '.o', '.obj', '.a', '.lib', '.db', '.sqlite', '.sqlite3',
]);

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};

/** Жобаның ішкі жолы бойынша (түбірлік папкасыз): null — өтеді */
export function classifyUploadPath(path: string): UploadSkip | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean).map((p) => p.toLowerCase());
  if (parts.length === 0) return null;
  if (parts.slice(0, -1).some((p) => JUNK_DIRS.has(p) || JUNK_DIR_SUFFIXES.some((s) => p.endsWith(s)))) return 'junk';
  const name = parts[parts.length - 1];
  const ext = extOf(name);
  if (JUNK_FILES.has(name) || JUNK_EXTENSIONS.has(ext) || JUNK_NAME_SUFFIXES.some((s) => name.endsWith(s))) return 'junk';
  if (SECRET_FILES.has(name) || SECRET_EXTENSIONS.has(ext)) return 'secret';
  if (name.startsWith('.env.') && !ENV_TEMPLATE_SUFFIXES.has(name.slice(5))) return 'secret';
  if (BLOCKED_EXTENSIONS.has(ext)) return 'blocked';
  return null;
}

/** «жоба/src/a.py» → «src/a.py»: жүктелетін папканың өз аты тексеріске кірмейді */
export function innerPath(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const slash = norm.indexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}
