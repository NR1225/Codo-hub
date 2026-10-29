/* Терминал шығысынан dev-сервер адресін табу (Vite, Next, CRA, http-server т.б.)
   — табылса, жоба сайттың өз «Алдын ала көрініс» панелінде ашылады. */

export const DEV_SERVER_EVENT = 'vibecoding:dev-server';
export const DEV_SERVER_STOP_EVENT = 'vibecoding:dev-server-stop';

export interface DevServerInfo {
  url: string;
  port: number;
  projectId: string | null;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const LOCAL_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s'"]*)?/;
const TAIL_CHARS = 400;
const REPEAT_MS = 5000;

const DEV_SCRIPTS = ['dev', 'start', 'serve'];

/** «Іске қосу» батырмасы үшін: жобада dev-скрипті бар package.json болса — оны іске қосатын команда.
    Алдымен түбірдегі, болмаса ең жақын ішкі папкадағы (мысалы frontend/package.json). */
export function devCommand(files: { path: string; content: string }[]): string | null {
  const manifests = files
    .filter(f => f.path === 'package.json' || f.path.endsWith('/package.json'))
    .filter(f => !f.path.includes('node_modules/'))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const file of manifests) {
    let scripts: Record<string, unknown> | undefined;
    try {
      scripts = JSON.parse(file.content)?.scripts;
    } catch {
      continue;
    }
    const script = scripts && DEV_SCRIPTS.find(name => typeof scripts![name] === 'string');
    if (!script) continue;
    const dir = file.path.slice(0, -'package.json'.length).replace(/\/$/, '');
    const run = script === 'start' ? 'start' : `run ${script}`;
    return dir ? `npm --prefix ${dir} ${run}` : `npm ${run}`;
  }
  return null;
}

/** Сервер іске қосылған компьютердің адресі емес, сайт ашылған хостты қолданамыз */
export function toBrowserUrl(port: number, path = '/'): string {
  const host = window.location.hostname || 'localhost';
  const hostPart = host.includes(':') ? `[${host}]` : host;
  return `http://${hostPart}:${port}${path}`;
}

/** Бір терминал сессиясының шығысын бақылайды. Шығыс бөліктерге бөлініп келеді,
    сондықтан алдыңғы бөліктің соңын сақтаймыз. */
export class DevServerDetector {
  private tail = '';
  private lastPort: number | null = null;
  private lastAt = 0;

  constructor(private getProjectId: () => string | null) {}

  feed(chunk: string): void {
    const text = (this.tail + chunk).replace(ANSI_RE, '');
    this.tail = text.slice(-TAIL_CHARS);
    const match = LOCAL_URL_RE.exec(text);
    if (!match) return;
    const port = Number(match[1]);
    if (!port || port > 65535) return;
    // Бір іске қосу бір адресті бірнеше рет басады; қайта іске қосылса — қайта ашамыз
    const now = Date.now();
    if (port === this.lastPort && now - this.lastAt < REPEAT_MS) return;
    this.lastPort = port;
    this.lastAt = now;
    this.tail = '';
    const info: DevServerInfo = {
      url: toBrowserUrl(port, match[2] || '/'),
      port,
      projectId: this.getProjectId(),
    };
    window.dispatchEvent(new CustomEvent<DevServerInfo>(DEV_SERVER_EVENT, { detail: info }));
  }

  /** Терминал жабылды — онда іске қосылған сервер де тоқтады */
  stop(): void {
    if (this.lastPort !== null) {
      window.dispatchEvent(new CustomEvent(DEV_SERVER_STOP_EVENT, {
        detail: { port: this.lastPort, projectId: this.getProjectId() },
      }));
    }
    this.reset();
  }

  reset(): void {
    this.tail = '';
    this.lastPort = null;
    this.lastAt = 0;
  }
}
