import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding, normalizePath } from '../../contexts/VibecodingContext';
import { buildPreview, pickEntry, resolvePath, PREVIEW_MSG } from './previewBuilder';
import { setPreview, pushPreviewConsole, clearPreviewConsole } from '../../utils/vibeActivity';
import { PlayIcon, GlobeIcon, RefreshIcon, CloseIcon, TrashIcon, TerminalIcon, ChevronDownIcon } from './icons';

interface ConsoleLine {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
}

const MAX_LINES = 500;
const AUTO_RELOAD_MS = 600;

interface PreviewPanelProps {
  /** Іске қосу сұралған сайын артады — кіру файлы қайта таңдалады */
  runId: number;
  /** Терминалда іске қосылған dev-сервердің адресі — болса, файлдардың орнына соны көрсетеді */
  serverUrl?: string | null;
  /** «Іске қосу» терминалда dev-серверді бастады, адресі әлі шықпады */
  serverStarting?: boolean;
  onServerClose?: () => void;
  onClose: () => void;
}

/* Жобаны sandbox iframe ішінде іске қосу (HTML/CSS/JS).
   allow-same-origin берілмейді — жоба коды сайттың cookie/localStorage-іне қол жеткізе алмайды. */
const PreviewPanel: React.FC<PreviewPanelProps> = ({ runId, serverUrl, serverStarting, onServerClose, onClose }) => {
  const { t } = useTranslation();
  const { activeProject, activeFile } = useVibecoding();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [entryPath, setEntryPath] = useState<string | null>(null);
  const [srcDoc, setSrcDoc] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [autoReload, setAutoReload] = useState(true);
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const lineId = useRef(0);

  // Іске қосу: белсенді файлдан кіру нүктесін анықтау
  useEffect(() => {
    if (!activeProject) return;
    setEntryPath(pickEntry(activeProject, activeFile)?.path ?? null);
    setReloadKey(k => k + 1);
    // Тек жаңа іске қосуда — файл ауысқан сайын емес
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, activeProject?.id]);

  const entry = useMemo(
    () => activeProject?.files.find(f => normalizePath(f.path) === normalizePath(entryPath ?? '')) ?? null,
    [activeProject, entryPath],
  );

  const lastDoc = useRef('');
  const build = useCallback(() => {
    if (!activeProject) return;
    const result = buildPreview(activeProject, entry);
    const next = result.ok ? result.html : '';
    // Құжат өзгермесе iframe қайта жүктелмейді — консоль да сақталады
    if (next === lastDoc.current) return;
    lastDoc.current = next;
    setSrcDoc(next);
    setLines([]);
    clearPreviewConsole();
  }, [activeProject, entry]);

  // Бүркіт қай бет іске қосылғанын білуі үшін
  useEffect(() => {
    setPreview(entry?.path ?? null);
  }, [entry?.path]);
  useEffect(() => () => setPreview(null), []);

  // Қолмен қайта жүктеу / жаңа іске қосу — бірден (iframe key арқылы қайта құрылады)
  useEffect(() => {
    build();
    setLines([]);
    clearPreviewConsole();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey, entryPath]);

  // Файлдар өзгергенде — кідіріспен автоматты қайта жүктеу
  useEffect(() => {
    if (!autoReload) return;
    const timer = window.setTimeout(build, AUTO_RELOAD_MS);
    return () => window.clearTimeout(timer);
  }, [autoReload, build]);

  // iframe-тен келетін console хабарлары мен беттер арасындағы өтулер
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const data = e.data;
      if (!data || data.source !== PREVIEW_MSG) return;
      if (data.type === 'console') {
        const line: ConsoleLine = { id: ++lineId.current, level: data.level, text: String(data.text ?? '') };
        setLines(prev => [...prev.slice(-(MAX_LINES - 1)), line]);
        pushPreviewConsole(line.level, line.text);
      } else if (data.type === 'navigate' && entryPath && typeof data.href === 'string') {
        setEntryPath(resolvePath(entryPath, data.href));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [entryPath]);

  const errorCount = lines.filter(l => l.level === 'error').length;

  return (
    <div className="vx-term-wrap">
      <div className="vx-term vx-preview">
        <div className="vx-term__bar select-none">
          <span className="vx-term__icon">
            <GlobeIcon size={15} />
          </span>
          <span className="vx-term__title">{t('vibecoding.preview.title', 'Алдын ала көрініс')}</span>
          {serverUrl ? (
            <span className="vx-preview__entry vx-preview__server" title={serverUrl}>
              {serverUrl.replace(/^https?:\/\//, '')}
              <button
                type="button"
                className="vx-preview__server-close"
                onClick={onServerClose}
                title={t('vibecoding.preview.serverClose', 'Жоба файлдарын көрсету')}
              >
                <CloseIcon size={11} />
              </button>
            </span>
          ) : (
            entry && <span className="vx-preview__entry" title={entry.path}>{entry.path}</span>
          )}

          <div className="vx-term__actions">
            {!serverUrl && (
              <label className="vx-preview__auto" title={t('vibecoding.preview.autoHint', 'Файл өзгергенде қайта жүктеу')}>
                <input type="checkbox" checked={autoReload} onChange={e => setAutoReload(e.target.checked)} />
                <span>{t('vibecoding.preview.auto', 'Авто')}</span>
              </label>
            )}
            <button
              type="button"
              onClick={() => setReloadKey(k => k + 1)}
              className="vx-term__action"
              title={t('vibecoding.preview.reload', 'Қайта жүктеу')}
            >
              <RefreshIcon size={14} />
            </button>
            <span className="vx-term__sep" />
            <button
              type="button"
              onClick={onClose}
              className="vx-term__action vx-term__action--danger"
              title={t('vibecoding.preview.close', 'Жабу')}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        </div>

        <div className="vx-preview__body">
          {serverUrl ? (
            /* Dev-сервер өз портында — басқа origin, сондықтан сайттың DOM/localStorage-іне жете алмайды.
               allow-same-origin керек: онсыз Vite модульдері мен HMR жүктелмейді. */
            <iframe
              key={`${serverUrl}#${reloadKey}`}
              className="vx-preview__frame"
              title={t('vibecoding.preview.title', 'Алдын ала көрініс')}
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-pointer-lock"
              src={serverUrl}
            />
          ) : serverStarting ? (
            <div className="vx-preview__empty">
              <PlayIcon size={22} />
              <p>{t('vibecoding.preview.starting', 'Жоба іске қосылып жатыр… Терминалда барысын көре аласыз.')}</p>
            </div>
          ) : srcDoc ? (
            <iframe
              key={reloadKey}
              ref={iframeRef}
              className="vx-preview__frame"
              title={t('vibecoding.preview.title', 'Алдын ала көрініс')}
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock"
              srcDoc={srcDoc}
            />
          ) : (
            <div className="vx-preview__empty">
              <PlayIcon size={22} />
              <p>{t('vibecoding.preview.noEntry', 'Іске қосатын файл табылмады. Жобаға index.html немесе .js файлын қосыңыз.')}</p>
            </div>
          )}
        </div>

        {/* Консоль — iframe ішіндегі console.log және қателер (dev-сервердікі терминалда көрінеді) */}
        {!serverUrl && !serverStarting && (
        <div className={`vx-preview__console ${consoleOpen ? 'is-open' : ''}`}>
          <div className="vx-preview__console-bar">
            <button type="button" className="vx-preview__console-toggle" onClick={() => setConsoleOpen(v => !v)}>
              <span className="vx-preview__chevron"><ChevronDownIcon size={13} /></span>
              <TerminalIcon size={13} />
              <span>{t('vibecoding.preview.console', 'Консоль')}</span>
              {lines.length > 0 && <span className="vx-preview__count">{lines.length}</span>}
              {errorCount > 0 && <span className="vx-preview__count is-error">{errorCount}</span>}
            </button>
            <button
              type="button"
              onClick={() => { setLines([]); clearPreviewConsole(); }}
              className="vx-term__action"
              title={t('vibecoding.preview.clearConsole', 'Консольді тазалау')}
            >
              <TrashIcon size={13} />
            </button>
          </div>
          {consoleOpen && (
            <div className="vx-preview__logs">
              {lines.length === 0 ? (
                <div className="vx-preview__log is-empty">{t('vibecoding.preview.consoleEmpty', 'Әзірге хабар жоқ')}</div>
              ) : (
                lines.map(l => (
                  <div key={l.id} className={`vx-preview__log is-${l.level}`}>{l.text}</div>
                ))
              )}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

export default PreviewPanel;
