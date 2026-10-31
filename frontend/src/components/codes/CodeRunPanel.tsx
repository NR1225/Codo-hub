import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { apiService, RunInfo } from '../../utils/api';
import { useAuth } from '../../contexts/AuthContext';
import { detectRunCommands } from '../vibecoding/terminalCommands';
import type { Project } from '../../contexts/VibecodingContext';
import { DEV_SERVER_EVENT, DEV_SERVER_STOP_EVENT, type DevServerInfo } from '../../utils/devServer';
import { CloseIcon, ExternalIcon, GlobeIcon, MonitorIcon, PlayIcon, RefreshIcon, TrashIcon } from '../home/icons';
import './CodeRunPanel.css';

// xterm (~200KB) тек терминалмен іске қосылатын жобада жүктеледі
const CodeRunTerminal = lazy(() => import('./CodeRunTerminal'));

const RUN_MSG = 'code-run';
const MAX_LINES = 500;

interface ConsoleLine {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

interface CodeRunPanelProps {
  codeId: string;
  /** Әр «Іске қосу» басылғанда артады — жоба қайта іске қосылады */
  runId: number;
  /** Ашық тұрған файл (жоба түбірінсіз жол немесе толық folderPath) — HTML болса сол бет ашылады */
  selectedPath?: string | null;
  onClose: () => void;
}

/** «Жоба/src/a.html» → «src/a.html»: жоба файлдарының ішінен сәйкесін табамыз */
function matchPath(paths: string[], selected?: string | null): string | null {
  if (!selected) return null;
  const clean = selected.replace(/\\/g, '/');
  return paths.find((p) => clean === p || clean.endsWith(`/${p}`)) ?? null;
}

/* Жобаны кодты көру бетінің өзінде іске қосу.
   Веб-жоба — sandbox iframe-де, файлдары серверден нақты URL-мен (кез келген көлемде).
   Python, Node, Go… — қолданушының терминалында, жобаның көшірмесінде. */
const CodeRunPanel: React.FC<CodeRunPanelProps> = ({ codeId, runId, selectedPath, onClose }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState<string | null>(null);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const lineId = useRef(0);

  const [command, setCommand] = useState<string | null>(null);
  const [termStatus, setTermStatus] = useState<{ status: string; error: string | null }>({ status: 'connecting', error: null });
  // Терминалда іске қосылған dev-сервер — жоба осы беттің өзінде, терминалдың үстінде ашылады
  const [server, setServer] = useState<DevServerInfo | null>(null);
  const [serverOpen, setServerOpen] = useState(true);
  const [serverReload, setServerReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setLoadError(null);
    apiService
      .getRunInfo(codeId)
      .then((data) => !cancelled && setInfo(data))
      .catch((err) => !cancelled && setLoadError(err?.message || t('viewCode.runPanel.loadError', 'Жобаны іске қосу мүмкін болмады')));
    return () => {
      cancelled = true;
    };
  }, [codeId, t]);

  // Терминал командалары: жобаның түбіріндегі файлдарға қарап (Vibecoding-тегімен бірдей)
  const commands = useMemo(() => {
    if (!info || info.kind !== 'terminal') return [];
    const project = {
      id: codeId,
      name: '',
      createdAt: '',
      updatedAt: '',
      files: info.paths.map((path) => ({
        id: path,
        path,
        name: path.split('/').pop() || path,
        content: path === 'package.json' ? info.packageJson || '' : '',
        language: '',
        isDirty: false,
      })),
    } satisfies Project;
    return detectRunCommands(project).filter((c) => !/install/.test(c.cmd));
  }, [info, codeId]);

  useEffect(() => {
    setCommand(commands[0]?.cmd ?? null);
  }, [commands]);

  // Ашық тұрған HTML файл болса — сол бет, әйтпесе сервер таңдаған кіру файлы
  const entry = useMemo(() => {
    if (!info || info.kind !== 'web') return null;
    const selected = matchPath(info.paths, selectedPath);
    return selected && /\.html?$/i.test(selected) ? selected : info.entry;
  }, [info, selectedPath]);

  const src = entry ? apiService.runUrl(codeId, entry, info?.runToken) : '';

  // Жаңа іске қосу — iframe қайта жасалады, консоль тазарады
  useEffect(() => {
    setReloadKey((k) => k + 1);
  }, [runId]);
  useEffect(() => {
    setLines([]);
    setPage(entry);
  }, [reloadKey, entry]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || data.source !== RUN_MSG) return;
      if (data.type === 'console') {
        const line: ConsoleLine = { id: ++lineId.current, level: data.level, text: String(data.text ?? '') };
        setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), line]);
        if (line.level === 'error') setConsoleOpen(true);
      } else if (data.type === 'page' && typeof data.path === 'string') {
        // /api/run/<id>/[~қолтаңба/]src/page.html → src/page.html
        const marker = `/run/${codeId}/`;
        const at = data.path.indexOf(marker);
        if (at !== -1) setPage(decodeURIComponent(data.path.slice(at + marker.length).replace(/^~[^/]+\//, '')));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [codeId]);

  // Бетте тек осы панельдің терминалы бар — оның шығысында табылған адрес біздікі
  useEffect(() => {
    const onServer = (e: Event) => {
      setServer((e as CustomEvent<DevServerInfo>).detail);
      setServerOpen(true);
    };
    const onServerStop = (e: Event) => {
      const { port } = (e as CustomEvent<{ port: number }>).detail;
      setServer((prev) => (prev && prev.port === port ? null : prev));
    };
    window.addEventListener(DEV_SERVER_EVENT, onServer);
    window.addEventListener(DEV_SERVER_STOP_EVENT, onServerStop);
    return () => {
      window.removeEventListener(DEV_SERVER_EVENT, onServer);
      window.removeEventListener(DEV_SERVER_STOP_EVENT, onServerStop);
    };
  }, []);

  // Қайта іске қосу не басқа команда — ескі сервердің адресі енді жарамсыз
  useEffect(() => {
    setServer(null);
  }, [reloadKey, command, codeId]);

  const onTermStatus = useCallback((status: string, error: string | null) => setTermStatus({ status, error }), []);

  const errorCount = lines.filter((l) => l.level === 'error').length;
  const isWeb = info?.kind === 'web' && !!src;
  const isTerminal = info?.kind === 'terminal';
  const showServer = isTerminal && !!server && serverOpen;

  return (
    <section className="vc-panel vc-run-panel" aria-label={t('viewCode.runPanel.title', 'Іске қосу')}>
      <div className="vc-panel__head">
        <span className="vc-run-panel__title">
          {isTerminal ? <MonitorIcon /> : <GlobeIcon />}
          <span>{isTerminal ? t('viewCode.runPanel.terminal', 'Терминал') : t('viewCode.runPanel.title', 'Іске қосу')}</span>
          {isWeb && page && <span className="vc-run-panel__path" title={page}>{page.split('?')[0]}</span>}
          {isTerminal && termStatus.status !== 'open' && (
            <span className="vc-run-panel__path">
              {termStatus.status === 'connecting'
                ? t('viewCode.runPanel.connecting', 'Қосылып жатыр…')
                : termStatus.error || t('viewCode.runPanel.disconnected', 'Ажыратылды')}
            </span>
          )}
        </span>

        <div className="vc-run-panel__actions">
          {isTerminal && commands.length > 1 && (
            <select
              className="vc-run-panel__select"
              value={command ?? ''}
              onChange={(e) => setCommand(e.target.value)}
              aria-label={t('viewCode.runPanel.command', 'Команда')}
            >
              {commands.map((c) => (
                <option key={c.cmd} value={c.cmd}>{c.label}</option>
              ))}
            </select>
          )}
          {isTerminal && server && (
            <button
              type="button"
              className={`vc-icon-btn ${serverOpen ? 'is-active' : ''}`}
              onClick={() => setServerOpen((v) => !v)}
              title={serverOpen ? t('viewCode.runPanel.hidePreview', 'Көріністі жасыру') : t('viewCode.runPanel.showPreview', 'Көріністі көрсету')}
              aria-pressed={serverOpen}
            >
              <GlobeIcon />
            </button>
          )}
          {(isWeb || (isTerminal && server)) && (
            <a
              className="vc-icon-btn"
              href={isWeb ? src : server!.url}
              target="_blank"
              rel="noopener noreferrer"
              title={t('viewCode.runPanel.openTab', 'Толық бетте ашу')}
              aria-label={t('viewCode.runPanel.openTab', 'Толық бетте ашу')}
            >
              <ExternalIcon />
            </a>
          )}
          {(isWeb || isTerminal) && (
            <button
              type="button"
              className="vc-icon-btn"
              onClick={() => setReloadKey((k) => k + 1)}
              title={t('viewCode.runPanel.restart', 'Қайта іске қосу')}
            >
              <RefreshIcon />
            </button>
          )}
          <button type="button" className="vc-icon-btn x-close" onClick={onClose} title={t('viewCode.runPanel.close', 'Жабу')}>
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      <div className="vc-run-panel__body">
        {loadError ? (
          <p className="vc-empty">{loadError}</p>
        ) : !info ? (
          <p className="vc-empty">{t('common.loading')}</p>
        ) : isWeb ? (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            className="vc-run__frame"
            title={t('viewCode.runPanel.title', 'Іске қосу')}
            src={src}
            sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads"
          />
        ) : isTerminal ? (
          user ? (
            <>
              {showServer && (
                <div className="vc-run__server">
                  <div className="vc-run__server-bar">
                    <span className="vc-run-panel__path" title={server!.url}>{server!.url.replace(/^https?:\/\//, '')}</span>
                    <button
                      type="button"
                      className="vc-icon-btn vc-icon-btn--sm"
                      onClick={() => setServerReload((k) => k + 1)}
                      title={t('viewCode.runPanel.reloadPreview', 'Бетті жаңарту')}
                    >
                      <RefreshIcon />
                    </button>
                  </div>
                  <iframe
                    key={`${server!.url}#${serverReload}`}
                    className="vc-run__frame"
                    title={t('viewCode.runPanel.title', 'Іске қосу')}
                    src={server!.url}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-pointer-lock allow-downloads"
                  />
                </div>
              )}
              <Suspense fallback={<p className="vc-empty">{t('common.loading')}</p>}>
                {/* Қайта іске қосу — жаңа сессия (ескі бағдарлама жұмыс істеп тұрса да).
                    Көрініс ашылса да терминал қайта құрылмайды — тек биіктігі кішірейеді */}
                <div className={`vc-run__term-wrap ${showServer ? 'is-docked' : ''}`}>
                  <CodeRunTerminal key={`${codeId}-${reloadKey}-${command}`} codeId={codeId} command={command} runKey={reloadKey} onStatus={onTermStatus} />
                </div>
              </Suspense>
            </>
          ) : (
            <div className="vc-empty vc-run-panel__login">
              <p>{t('viewCode.runPanel.loginRequired', 'Бұл жоба терминалда іске қосылады — ол үшін аккаунтқа кіріңіз.')}</p>
              <Link to="/login" className="vc-btn vc-btn--primary vc-btn--sm">{t('viewCode.runPanel.login', 'Кіру')}</Link>
            </div>
          )
        ) : (
          <div className="vc-empty vc-run-panel__login">
            <PlayIcon size={22} />
            <p>{t('viewCode.runPanel.nothing', 'Іске қосатын файл табылмады: жобада index.html, .js, .py немесе package.json жоқ.')}</p>
          </div>
        )}
      </div>

      {/* Консоль — бет ішіндегі console.log және қателер */}
      {isWeb && (
        <div className={`vc-run-console ${consoleOpen ? 'is-open' : ''}`}>
          <div className="vc-run-console__bar">
            <button type="button" className="vc-run-console__toggle" onClick={() => setConsoleOpen((v) => !v)} aria-expanded={consoleOpen}>
              <span className="vc-run-console__chevron" aria-hidden="true">▾</span>
              {t('viewCode.runPanel.console', 'Консоль')}
              {lines.length > 0 && <span className="vc-count">{lines.length}</span>}
              {errorCount > 0 && <span className="vc-count is-error">{errorCount}</span>}
            </button>
            <button
              type="button"
              className="vc-icon-btn vc-icon-btn--sm"
              onClick={() => setLines([])}
              title={t('viewCode.runPanel.clearConsole', 'Консольді тазалау')}
            >
              <TrashIcon size={13} />
            </button>
          </div>
          {consoleOpen && (
            <div className="vc-run-console__logs">
              {lines.length === 0 ? (
                <div className="vc-run-console__log is-empty">{t('viewCode.runPanel.consoleEmpty', 'Әзірге хабар жоқ')}</div>
              ) : (
                lines.map((l) => (
                  <div key={l.id} className={`vc-run-console__log is-${l.level}`}>{l.text}</div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default CodeRunPanel;
