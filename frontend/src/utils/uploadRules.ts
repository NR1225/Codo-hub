/* Жобалар бетіне жүктелетін файлдардың ережесі — backend/utils/upload_rules.py-мен бірдей.
   Жобаның бәрі жүктеледі, тек кэш/қоқыс (node_modules, __pycache__, .git…) серверге жіберілмейді.
   Құпия (.env), база (.db) және тест деректері жүктеледі, бірақ сервер оларды қорғайды
   (backend/utils/protected_files.py): басқаларға мәндері бос үлгісі / бос базасы көрінеді. */

export type UploadKind = 'junk' | 'executable' | 'secret' | 'database' | 'binary';
/** @deprecated UploadKind */
export type UploadSkip = UploadKind;
/** Жүктеледі, бірақ түпнұсқасын тек иесі (немесе тест деректерін — жоба мүшелері) көреді */
export type ProtectionKind = 'secret' | 'database' | 'testdata';

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
  '.codo', // codo CLI-дің жергілікті коммит тарихы (.git сияқты)
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

const DATABASE_EXTENSIONS = new Set(['.db', '.sqlite', '.sqlite3', '.db3']);

// Орындалатын/орнатылатын файлдар — жүктелмейді (басқалар жүктеп алып ашуы мүмкін)
const EXECUTABLE_EXTENSIONS = new Set([
  '.exe', '.com', '.pif', '.scr', '.jar', '.msi', '.dmg', '.app',
  '.deb', '.rpm', '.pkg', '.apk', '.dll', '.so', '.dylib', '.sys', '.drv', '.ocx', '.cpl',
]);

const BINARY_EXTENSIONS = new Set(['.bin', '.class', '.o', '.obj', '.a', '.lib', '.wasm']);

// Тест деректері — тек жоба мүшелері көреді (backend protected_files.py-мен бірдей)
const TEST_DATA_DIRS = new Set([
  'fixtures', '__fixtures__', 'fixture', 'testdata', 'test_data', 'test-data',
  'seed', 'seeds', 'seeders', 'mock', 'mocks', '__mocks__', 'mock_data', 'mock-data',
  'sample_data', 'sample-data', 'dummy_data', 'dummy-data',
]);
const TEST_DATA_NAME_RE = /^(seed|seeds|fixture|fixtures|mock|mocks|dummy|sample[_-]?data|test[_-]?data)([._-]|$)/;
const DATA_EXTENSIONS = new Set([
  '.json', '.jsonl', '.ndjson', '.csv', '.tsv', '.sql', '.yaml', '.yml', '.xml', '.txt',
  '.db', '.sqlite', '.sqlite3', '.db3', '.xls', '.xlsx', '.parquet',
]);

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
};

/** Жобаның ішкі жолы бойынша (түбірлік папкасыз): null — кәдімгі код, junk — жүктелмейді */
export function classifyUploadPath(path: string): UploadKind | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean).map((p) => p.toLowerCase());
  if (parts.length === 0) return null;
  if (parts.slice(0, -1).some((p) => JUNK_DIRS.has(p) || JUNK_DIR_SUFFIXES.some((s) => p.endsWith(s)))) return 'junk';
  const name = parts[parts.length - 1];
  const ext = extOf(name);
  if (JUNK_FILES.has(name) || JUNK_EXTENSIONS.has(ext) || JUNK_NAME_SUFFIXES.some((s) => name.endsWith(s))) return 'junk';
  if (SECRET_FILES.has(name) || SECRET_EXTENSIONS.has(ext)) return 'secret';
  if (name.startsWith('.env.') && !ENV_TEMPLATE_SUFFIXES.has(name.slice(5))) return 'secret';
  if (EXECUTABLE_EXTENSIONS.has(ext)) return 'executable';
  if (DATABASE_EXTENSIONS.has(ext)) return 'database';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  return null;
}

/** Жүктелмейтін түрлер: кэш/қоқыс және .exe сияқты орындалатын файлдар */
export const isSkipped = (kind: UploadKind | null): boolean => kind === 'junk' || kind === 'executable';

/** Тест деректері ме: тест папкасындағы деректер файлы немесе seed/fixture/mock деп аталған файл */
export function isTestData(path: string): boolean {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean).map((p) => p.toLowerCase());
  const name = parts[parts.length - 1];
  if (!name || !DATA_EXTENSIONS.has(extOf(name))) return false;
  return parts.slice(0, -1).some((p) => TEST_DATA_DIRS.has(p)) || TEST_DATA_NAME_RE.test(name);
}

/** Сервер қалай қорғайды (шолуда көрсету үшін). .sql дамптың деректерін сервер мазмұнынан анықтайды */
export function protectionOf(path: string): ProtectionKind | null {
  const kind = classifyUploadPath(path);
  if (kind === 'secret') return 'secret';
  if (isTestData(path)) return 'testdata';
  if (kind === 'database') return 'database';
  return null;
}

/** «жоба/src/a.py» → «src/a.py»: жүктелетін папканың өз аты тексеріске кірмейді */
export function innerPath(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const slash = norm.indexOf('/');
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}
