import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useFileUpload, FolderUploadResult } from '../../hooks/useFileUpload';
import { CATEGORY_TAG_PREFIX, LANGUAGE_TAG_PREFIX } from '../../utils/codeCategories';
import { innerPath, ProtectionKind } from '../../utils/uploadRules';
import { filePath } from '../../utils/fileHandler';
import { apiService, GithubRepo } from '../../utils/api';
import { useGithubConnection } from '../../hooks/useGithubConnection';
import {
  CollectedProject,
  PreviewNode,
  ProjectScan,
  buildPreviewTree,
  canPickDirectory,
  collectFromDrop,
  collectFromHandle,
  collectFromInput,
  collectFromZip,
  formatBytes,
  pickDirectory,
  scanProject,
} from '../../utils/projectSource';
import {
  ArchiveIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  CodeBracketsIcon,
  DatabaseIcon,
  FileIcon,
  FolderIcon,
  GamepadIcon,
  GlobeIcon,
  InfinityIcon,
  LayersIcon,
  MonitorIcon,
  PhoneIcon,
  PlugIcon,
  ShieldIcon,
  SparkleIcon,
  TrashIcon,
  UsersIcon,
} from '../home/icons';
import './UploadModal.css';
import './ProjectUpload.css';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Берілсе — жүктелген соң шақырылып, терезе бірден жабылады (жоба бетіне өтпейді) */
  onSuccess?: (folderId: string) => void;
}

type Stage = 'pick' | 'scanning' | 'review' | 'uploading' | 'done';

const LANGUAGE_GROUPS: Record<string, string[]> = {
  'Web Development': ['HTML', 'CSS', 'JavaScript', 'TypeScript'],
  Backend: ['Python', 'Java', 'C++', 'C', 'C#', 'Go', 'Rust', 'PHP', 'Ruby'],
  Mobile: ['Swift', 'Kotlin', 'Dart'],
  'Data Science': ['R', 'MATLAB'],
  'Markup/Config': ['JSON', 'XML', 'YAML', 'Markdown'],
  Other: ['Shell', 'SQL', 'Other'],
};

// Тіл жолағының түстері (екі тақырыпта да оқылатын қанық реңктер)
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#e8c33a', Python: '#3f7cc4', Java: '#c9772e', 'C++': '#e0507c',
  C: '#7a8590', 'C#': '#3f9a3f', Go: '#2bb3d4', Rust: '#d9875a', PHP: '#7a86c2', Ruby: '#c7312f',
  Swift: '#f06a3a', Kotlin: '#9b6bf2', Dart: '#2cb5c0', HTML: '#e2583e', CSS: '#8c5bd6', Shell: '#6bbf4a',
  SQL: '#d6a133', R: '#2a6fbf', MATLAB: '#d9682d', JSON: '#9a9a9a', YAML: '#b0705a', XML: '#5f8f9f', Markdown: '#7f8790',
};

// Жобаның жалпы бағыттары. Мәндері бұрынғы категория тегтерімен бірдей (codeCategories.ts) —
// Кодтар тізімінің бөлімдері өзгеріссіз жұмыс істейді
const DIRECTIONS: { value: string; key: string; icon: React.ReactNode }[] = [
  { value: 'web-app', key: 'projectUpload.dirWeb', icon: <GlobeIcon /> },
  { value: 'android-app', key: 'projectUpload.dirAndroid', icon: <PhoneIcon /> },
  { value: 'ios-app', key: 'projectUpload.dirIos', icon: <PhoneIcon /> },
  { value: 'cross-platform-app', key: 'projectUpload.dirCrossPlatform', icon: <PhoneIcon /> },
  { value: 'desktop-app', key: 'projectUpload.dirDesktop', icon: <MonitorIcon /> },
  { value: 'api', key: 'projectUpload.dirBackend', icon: <PlugIcon /> },
  { value: 'machine-learning', key: 'projectUpload.dirAi', icon: <SparkleIcon size={15} /> },
  { value: 'game', key: 'projectUpload.dirGame', icon: <GamepadIcon /> },
  { value: 'database', key: 'projectUpload.dirDatabase', icon: <DatabaseIcon /> },
  { value: 'devops', key: 'projectUpload.dirDevops', icon: <InfinityIcon /> },
  { value: 'other', key: 'projectUpload.dirOther', icon: <LayersIcon size={15} /> },
];

// Қорғалған файлдар түрлері бойынша: атауы, кімге көрінетіні, белгісі
const PROTECTION_GROUPS: { kind: ProtectionKind; title: string; hint: string; icon: React.ReactNode }[] = [
  { kind: 'secret', title: 'projectUpload.groupSecret', hint: 'projectUpload.groupSecretHint', icon: <ShieldIcon size={15} /> },
  { kind: 'database', title: 'projectUpload.groupDatabase', hint: 'projectUpload.groupDatabaseHint', icon: <DatabaseIcon /> },
  { kind: 'testdata', title: 'projectUpload.groupTestdata', hint: 'projectUpload.groupTestdataHint', icon: <UsersIcon size={15} /> },
];

const ALL_LANGUAGES = Object.values(LANGUAGE_GROUPS).flat();
// Негізгі тіл ретінде таңдалмайтын қосалқы тілдер (конфиг, құжат)
const SUPPORTING_LANGUAGES = new Set(['JSON', 'XML', 'YAML', 'Markdown']);

/** Жобадағы маңызды тілдер: үлесі ≥5% (конфиг/құжат тілдерінсіз), көп дегенде 5, үлесі бойынша */
function detectLanguages(scan: ProjectScan): string[] {
  const code = scan.languages.filter((l) => !SUPPORTING_LANGUAGES.has(l.name) && ALL_LANGUAGES.includes(l.name));
  const total = code.reduce((s, l) => s + l.bytes, 0);
  const picked = code.filter((l, i) => i === 0 || l.bytes / (total || 1) >= 0.05).slice(0, 5).map((l) => l.name);
  if (picked.length) return picked;
  return ALL_LANGUAGES.includes(scan.mainLanguage) ? [scan.mainLanguage] : [];
}

/** Файлдарға қарап категория ұсыну (қолданушы өзгерте алады). Көп дегенде 3 */
function suggestCategories(scan: ProjectScan): string[] {
  const langs = new Set(scan.languages.map((l) => l.name));
  const paths = scan.files.map((f) => innerPath(filePath(f)).toLowerCase());
  const has = (test: (p: string) => boolean) => paths.some(test);
  const out: string[] = [];
  if (langs.has('Swift')) out.push('ios-app');
  if (has((p) => p.endsWith('androidmanifest.xml'))) out.push('android-app');
  if (langs.has('Dart') || has((p) => p.endsWith('pubspec.yaml'))) out.push('cross-platform-app');
  if (has((p) => p.endsWith('.ipynb'))) out.push('machine-learning');
  if (langs.has('HTML') || langs.has('CSS') || has((p) => /\.(tsx|jsx|vue|svelte)$/.test(p))) out.push('web-app');
  if (has((p) => /(^|\/)(routes|api|controllers|endpoints)\//.test(p))) out.push('api');
  if (langs.has('SQL') || has((p) => /(^|\/)migrations\//.test(p))) out.push('database');
  return [...new Set(out)].slice(0, 3);
}

/* ---------- Бірнешеуін таңдайтын дропдаун (тілдер, бағыттар) ---------- */

interface MultiOption {
  value: string;
  label: string;
  lead?: React.ReactNode;
  badge?: React.ReactNode;
  meta?: string;
  group?: string;
}

const MultiSelect: React.FC<{
  options: MultiOption[];
  selected: string[];
  onToggle: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  /** Таңдалған чиптің қосымша белгісі (мысалы, «негізгі») */
  chipBadge?: (value: string) => React.ReactNode;
}> = ({ options, selected, onToggle, placeholder, searchPlaceholder, chipBadge }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    searchRef.current?.focus();
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const byValue = new Map(options.map((o) => [o.value, o]));
  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <div
      ref={rootRef}
      className={`pu-ms ${open ? 'is-open' : ''}`}
      onKeyDown={(e) => {
        // Escape алдымен тізімді жабады, бүкіл терезені емес
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          setOpen(false);
        }
      }}
    >
      <div
        className="pu-ms__trigger"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {selected.length === 0 ? (
          <span className="pu-ms__placeholder">{placeholder}</span>
        ) : (
          <span className="pu-ms__chips">
            {selected.map((v) => {
              const o = byValue.get(v);
              return (
                <span key={v} className="pu-ms__chip">
                  {o?.lead}
                  {o?.label ?? v}
                  {chipBadge?.(v)}
                  <button
                    type="button"
                    className="pu-ms__remove"
                    aria-label={`${t('projectUpload.remove')}: ${o?.label ?? v}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(v);
                    }}
                  >
                    <CloseIcon size={11} />
                  </button>
                </span>
              );
            })}
          </span>
        )}
        <span className="pu-ms__chevron"><ChevronIcon /></span>
      </div>

      {open && (
        <div className="pu-ms__panel">
          {searchPlaceholder && (
            <input
              ref={searchRef}
              className="pu-ms__search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
            />
          )}
          <ul className="pu-ms__list" role="listbox" aria-multiselectable="true">
            {visible.map((o, i) => {
              const on = selected.includes(o.value);
              const showGroup = !q && o.group && o.group !== visible[i - 1]?.group;
              return (
                <React.Fragment key={o.value}>
                  {showGroup && <li className="pu-ms__group" role="presentation">{o.group}</li>}
                  <li role="option" aria-selected={on}>
                    <button type="button" className={`pu-ms__option ${on ? 'is-on' : ''}`} onClick={() => onToggle(o.value)}>
                      <span className="pu-check__box">{on && <CheckIcon />}</span>
                      {o.lead}
                      <span className="pu-ms__label">{o.label}</span>
                      {o.badge}
                      {o.meta && <span className="pu-ms__meta">{o.meta}</span>}
                    </button>
                  </li>
                </React.Fragment>
              );
            })}
            {visible.length === 0 && <li className="pu-ms__empty">{t('projectUpload.noMatches')}</li>}
          </ul>
        </div>
      )}
    </div>
  );
};

/* ---------- Қорғалған файлдар: түрлерге бөлінген, әрқайсысын жүктемеуге болады ---------- */

const ProtectedFiles: React.FC<{
  files: ProjectScan['protectedFiles'];
  sizes: Map<string, number>;
  excluded: Set<string>;
  onToggle: (paths: string[], include: boolean) => void;
}> = ({ files, sizes, excluded, onToggle }) => {
  const { t } = useTranslation();
  const kept = files.filter((f) => !excluded.has(f.path)).length;
  return (
    <div className="pu-card pu-guard">
      <div className="pu-guard__head">
        <span className="pu-guard__badge"><ShieldIcon size={16} /></span>
        <div className="pu-guard__intro">
          <strong>{t('projectUpload.protectedTitle')}</strong>
          <span>{t('projectUpload.protectedHint')}</span>
        </div>
        <span className="pu-guard__count" title={t('projectUpload.keptCount', { kept, total: files.length })}>
          {kept}/{files.length}
        </span>
      </div>

      {PROTECTION_GROUPS.map((group) => {
        const items = files.filter((f) => f.kind === group.kind);
        if (!items.length) return null;
        const paths = items.map((f) => f.path);
        const allOn = paths.every((p) => !excluded.has(p));
        return (
          <section key={group.kind} className={`pu-guard__group is-${group.kind}`}>
            <div className="pu-guard__group-head">
              <span className="pu-guard__icon">{group.icon}</span>
              <div className="pu-guard__group-text">
                <strong>{t(group.title)}</strong>
                <span>{t(group.hint)}</span>
              </div>
              {items.length > 1 && (
                <button type="button" className="pu-guard__all" onClick={() => onToggle(paths, !allOn)}>
                  {allOn ? t('projectUpload.excludeAll') : t('projectUpload.includeAll')}
                </button>
              )}
            </div>
            <ul className="pu-guard__list">
              {items.map((f) => {
                const inner = innerPath(f.path);
                const slash = inner.lastIndexOf('/');
                const on = !excluded.has(f.path);
                return (
                  <li key={f.path} className={`pu-guard__row ${on ? '' : 'is-off'}`}>
                    <span className="pu-guard__path" title={inner}>
                      {slash >= 0 && <span className="pu-guard__dir">{inner.slice(0, slash + 1)}</span>}
                      <span className="pu-guard__name">{inner.slice(slash + 1)}</span>
                    </span>
                    <span className="pu-guard__size">{formatBytes(sizes.get(f.path) ?? 0)}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={inner}
                      title={on ? t('projectUpload.willUpload') : t('projectUpload.wontUpload')}
                      className="pu-switch"
                      onClick={() => onToggle([f.path], !on)}
                    >
                      <span className="pu-switch__knob" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {kept < files.length && (
        <p className="pu-guard__note">{t('projectUpload.excludedNote', { count: files.length - kept })}</p>
      )}
    </div>
  );
};

/* ---------- Хабарлама (қате / ескерту / ақпарат) ---------- */

type NoticeTone = 'error' | 'warn' | 'info';

const NOTICE_TITLES: Record<NoticeTone, string> = {
  error: 'projectUpload.alertError',
  warn: 'projectUpload.alertWarn',
  info: 'projectUpload.alertInfo',
};

const NoticeGlyph: React.FC<{ tone: NoticeTone }> = ({ tone }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tone === 'warn' ? (
      <>
        <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ) : (
      <>
        <circle cx="12" cy="12" r="9" />
        {tone === 'error' ? <path d="M12 7.5v5M12 16.5h.01" /> : <path d="M12 11v5M12 7.5h.01" />}
      </>
    )}
  </svg>
);

const Notice: React.FC<{ tone: NoticeTone; message: string; onDismiss?: () => void }> = ({ tone, message, onDismiss }) => {
  const { t } = useTranslation();
  return (
    <div className={`pu-notice is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="pu-notice__icon"><NoticeGlyph tone={tone} /></span>
      <div className="pu-notice__text">
        <strong>{t(NOTICE_TITLES[tone])}</strong>
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button type="button" className="pu-notice__close" onClick={onDismiss} aria-label={t('projectUpload.dismiss')}>
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
};

/* ---------- Папка рұқсаты: Chrome-ның жүйелік терезесінен бұрын түсіндіреміз ---------- */

// Chrome-ның «Разрешить этому сайту просматривать файлы?» терезесін безендіру мүмкін емес —
// сондықтан алдымен өз стиліміздегі түсіндірмені көрсетеміз, «Жалғастыру» басылғанда ғана picker ашылады
const FOLDER_PRIME_SKIP_KEY = 'codo:folderPrimeSkip';

const readPrimeSkip = () => {
  try {
    return localStorage.getItem(FOLDER_PRIME_SKIP_KEY) === '1';
  } catch {
    return false;
  }
};

const FolderPrime: React.FC<{ onContinue: (skipNext: boolean) => void; onCancel: () => void }> = ({ onContinue, onCancel }) => {
  const { t } = useTranslation();
  const [skipNext, setSkipNext] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueRef.current?.focus();
  }, []);

  return (
    <div className="pu-prime" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="pu-prime__card" role="alertdialog" aria-modal="true" aria-labelledby="pu-prime-title" aria-describedby="pu-prime-text">
        <div className="pu-prime__glyph">
          <FolderIcon size={26} />
          <span className="pu-prime__badge"><ShieldIcon size={13} /></span>
        </div>
        <h3 id="pu-prime-title">{t('projectUpload.primeTitle')}</h3>
        <p id="pu-prime-text">{t('projectUpload.primeText')}</p>

        {/* Браузер терезесінің шағын нобайы — қай батырманы басу керегін көрсетеді */}
        <div className="pu-prime__mock" aria-hidden="true">
          <span className="pu-prime__mock-line" />
          <span className="pu-prime__mock-line is-short" />
          <div className="pu-prime__mock-actions">
            <span className="pu-prime__mock-btn is-allow">{t('projectUpload.primeAllow')}</span>
            <span className="pu-prime__mock-btn">{t('projectUpload.primeDeny')}</span>
          </div>
        </div>

        <ul className="pu-prime__points">
          <li><CheckIcon /> {t('projectUpload.primeRead')}</li>
          <li><TrashIcon size={14} /> {t('projectUpload.primeJunk')}</li>
          <li><ShieldIcon size={14} /> {t('projectUpload.primeSecret')}</li>
        </ul>

        <label className="pu-prime__skip">
          <input type="checkbox" checked={skipNext} onChange={(e) => setSkipNext(e.target.checked)} />
          <span className="pu-check__box">{skipNext && <CheckIcon />}</span>
          {t('projectUpload.primeSkip')}
        </label>

        <div className="pu-prime__actions">
          <button type="button" className="pu-btn pu-btn--ghost" onClick={onCancel}>
            {t('common.cancel', 'Cancel')}
          </button>
          <button ref={continueRef} type="button" className="pu-btn pu-btn--primary" onClick={() => onContinue(skipNext)}>
            <FolderIcon size={16} /> {t('projectUpload.primeContinue')}
          </button>
        </div>
      </div>
    </div>
  );
};

// GitHub белгісі — сілтеме өрісінің ішінде
const GithubMark: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

const LockMark: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/* ---------- «Ойланып жатыр»: қадамдар бірінен соң бірі белгіленеді ---------- */

// Қадам уақытпен алға жылжиды, бірақ соңғысы жұмыс біткенше белсенді қалады
const useSteppedTimer = (count: number, intervalMs: number, from = 0) => {
  const [step, setStep] = useState(from);
  useEffect(() => {
    setStep((s) => Math.max(s, from));
  }, [from]);
  useEffect(() => {
    const id = window.setInterval(() => setStep((s) => Math.min(count - 1, s + 1)), intervalMs);
    return () => window.clearInterval(id);
  }, [count, intervalMs]);
  return step;
};

const ThinkingSteps: React.FC<{ steps: string[]; active: number }> = ({ steps, active }) => {
  const { t } = useTranslation();
  return (
    <ol className="pu-think" aria-live="polite">
      {steps.map((key, i) => {
        const state = i < active ? 'is-done' : i === active ? 'is-active' : 'is-wait';
        return (
          <li key={key} className={`pu-think__step ${state}`}>
            <span className="pu-think__mark">{i < active ? <CheckIcon /> : <i />}</span>
            <span className="pu-think__label">
              {t(key)}
              {i === active && <span className="pu-think__dots" aria-label={t('projectUpload.thinking')}><i /><i /><i /></span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
};

const SCAN_STEPS = ['projectUpload.scanRead', 'projectUpload.scanFilter', 'projectUpload.scanLangs', 'projectUpload.scanProtect'];
const UPLOAD_STEPS = ['projectUpload.upSend', 'projectUpload.upCheck', 'projectUpload.upSave', 'projectUpload.upFinish'];

const ScanningState: React.FC = () => {
  const { t } = useTranslation();
  const active = useSteppedTimer(SCAN_STEPS.length, 650);
  return (
    <div className="pu-state">
      <div className="pu-orb" aria-hidden="true"><span /><span /><FolderIcon size={22} /></div>
      <p className="pu-state__title pu-shimmer">{t('projectUpload.scanning')}</p>
      <ThinkingSteps steps={SCAN_STEPS} active={active} />
    </div>
  );
};

// Файлдар жіберіліп біткен соң сервер жауабын күтеміз — сол кезде де бірдеңе жылжып тұрсын
const ServerThinking: React.FC = () => {
  const active = useSteppedTimer(UPLOAD_STEPS.length, 1800, 1);
  return <ThinkingSteps steps={UPLOAD_STEPS} active={active} />;
};

/* ---------- Жоба ағашы (шолу) ---------- */

const TreeRows: React.FC<{ nodes: PreviewNode[]; depth: number; open: Set<string>; onToggle: (p: string) => void }> = ({
  nodes,
  depth,
  open,
  onToggle,
}) => (
  <ul className="pu-tree" role={depth === 0 ? 'tree' : 'group'}>
    {nodes.map((node) => {
      const isOpen = open.has(node.path);
      return (
        <li key={`${node.path}:${node.isFile}`} role="treeitem" aria-expanded={node.isFile ? undefined : isOpen}>
          <button
            type="button"
            className="pu-tree__row"
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => !node.isFile && onToggle(node.path)}
            disabled={node.isFile}
          >
            {node.isFile ? (
              <span className="pu-tree__chevron" />
            ) : (
              <span className={`pu-tree__chevron ${isOpen ? 'is-open' : ''}`}><ChevronIcon /></span>
            )}
            <span className="pu-tree__icon">{node.isFile ? <FileIcon size={14} /> : <FolderIcon size={14} />}</span>
            <span className="pu-tree__name">{node.name}</span>
            <span className="pu-tree__meta">
              {!node.isFile && <>{node.files} · </>}
              {formatBytes(node.size)}
            </span>
          </button>
          {!node.isFile && isOpen && (
            <TreeRows nodes={node.children} depth={depth + 1} open={open} onToggle={onToggle} />
          )}
        </li>
      );
    })}
  </ul>
);

/* ---------- Терезе ---------- */

const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { uploading, error, uploadProgress, uploadFolder, reset } = useFileUpload();

  const [stage, setStage] = useState<Stage>('pick');
  const [dragActive, setDragActive] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [scan, setScan] = useState<ProjectScan | null>(null);
  const [openDirs, setOpenDirs] = useState<Set<string>>(new Set());
  // Жүктемеуге шешілген қорғалған файлдар (жолдары)
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<FolderUploadResult | null>(null);

  const [title, setTitle] = useState('');
  // Таңдалған тілдер (біріншісі — негізгі) мен категориялар; автоматты анықталғандары алдын ала белгіленеді
  const [languages, setLanguages] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [autoCategories, setAutoCategories] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  // Жабық жоба — тек иесі мен жобаға қосылған мүшелер көреді
  const [isPrivate, setIsPrivate] = useState(false);
  const [primeOpen, setPrimeOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  // Жабық репо үшін GitHub профилі; қосылған болса — өз реполарының тізімі
  const github = useGithubConnection(isOpen);
  const [repos, setRepos] = useState<GithubRepo[] | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [reposLoading, setReposLoading] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  // Жүктелетін файлдар: қолданушы өшірген қорғалған файлдарсыз
  const files = useMemo(
    () => (scan ? (excluded.size ? scan.files.filter((f) => !excluded.has(filePath(f))) : scan.files) : []),
    [scan, excluded]
  );
  const bytes = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const protectedSizes = useMemo(() => {
    const wanted = new Set(scan?.protectedFiles.map((f) => f.path));
    const sizes = new Map<string, number>();
    scan?.files.forEach((f) => {
      const path = filePath(f);
      if (wanted.has(path)) sizes.set(path, f.size);
    });
    return sizes;
  }, [scan]);
  const toggleProtected = useCallback((paths: string[], include: boolean) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      paths.forEach((p) => (include ? next.delete(p) : next.add(p)));
      return next;
    });
  }, []);

  const tree = useMemo(() => buildPreviewTree(files), [files]);
  // Көлем мен файл санына шек жоқ — үлкен жоба бөліктермен жүктеледі (useFileUpload)
  const canSubmit = !!scan && files.length > 0 && !!title.trim() && languages.length > 0 && categories.length > 0 && !uploading;

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<string[]>>, value: string) =>
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

  const resetAll = useCallback(() => {
    setStage('pick');
    setScan(null);
    setResult(null);
    setSourceError(null);
    setOpenDirs(new Set());
    setExcluded(new Set());
    setTitle('');
    setLanguages([]);
    setCategories([]);
    setAutoCategories([]);
    setDescription('');
    setIsPrivate(false);
    setPrimeOpen(false);
    setGithubUrl('');
    setReposOpen(false);
    reset();
  }, [reset]);

  const handleClose = useCallback(() => {
    if (uploading) return;
    resetAll();
    onClose();
  }, [uploading, resetAll, onClose]);

  // Терезе ашылғанда — «Жабық жоба» белгісі иесінің баптауынан (Баптаулар → «Жобалар»)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    apiService.getProjectSettings().then(
      (s) => { if (!cancelled) setIsPrivate(s.defaultPrivate); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Алдымен рұқсат түсіндірмесін жабамыз, сосын ғана терезенің өзін
      if (primeOpen) setPrimeOpen(false);
      else handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose, primeOpen]);

  if (!isOpen) return null;

  /* ----- Көзден оқу ----- */

  const load = async (collect: () => Promise<CollectedProject | null>, failKey: string) => {
    setSourceError(null);
    reset();
    setStage('scanning');
    try {
      const collected = await collect();
      if (!collected) throw new Error('unsupported');
      const next = await scanProject(collected);
      setScan(next);
      setExcluded(new Set());
      // Ағаш жабық басталады: тек бірінші деңгей көрінеді
      setOpenDirs(new Set());
      setTitle((prev) => prev || next.name);
      setLanguages(detectLanguages(next));
      const suggested = suggestCategories(next);
      setAutoCategories(suggested);
      setCategories(suggested);
      setStage('review');
    } catch (err) {
      console.error('Project read failed:', err);
      setSourceError(t(failKey));
      setStage(scan ? 'review' : 'pick');
    }
  };

  const handleFolderInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (list && list.length > 0) load(async () => collectFromInput(list), 'projectUpload.dropError');
    e.target.value = '';
  };

  // Chrome/Edge: қоқыс папкаларына кірмей таңдау; басқа браузерлерде — әдеттегі webkitdirectory
  const openDirectoryPicker = async () => {
    let handle: Awaited<ReturnType<typeof pickDirectory>>;
    try {
      handle = await pickDirectory();
    } catch (err) {
      console.warn('showDirectoryPicker failed, falling back to input:', err);
      folderInputRef.current?.click();
      return;
    }
    if (handle) load(() => collectFromHandle(handle!), 'projectUpload.dropError');
  };

  const pickFolder = () => {
    if (!canPickDirectory()) {
      folderInputRef.current?.click();
      return;
    }
    if (readPrimeSkip()) openDirectoryPicker();
    else setPrimeOpen(true);
  };

  // «Жалғастыру» басуы — жаңа user activation, picker осы click ішінде ашылады
  const continueFromPrime = (skipNext: boolean) => {
    if (skipNext) {
      try {
        localStorage.setItem(FOLDER_PRIME_SKIP_KEY, '1');
      } catch {
        /* жеке режимде сақталмаса да picker ашыла береді */
      }
    }
    setPrimeOpen(false);
    openDirectoryPicker();
  };

  const handleZipInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) load(() => collectFromZip(file), 'projectUpload.zipError');
    e.target.value = '';
  };

  // GitHub сілтемесі: архивті сервер жүктейді, әрі қарай кәдімгі ZIP сияқты өңделеді
  const handleGithubSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = githubUrl.trim();
    if (url) importGithub(url);
  };

  const importGithub = (url: string) => {
    setReposOpen(false);
    setSourceError(null);
    reset();
    setStage('scanning');
    apiService
      .downloadGithubArchive(url)
      .then(({ zip, name, subdir }) => load(() => collectFromZip(zip, { rootName: name, subdir }), 'projectUpload.zipError'))
      .catch((err: Error) => {
        console.error('GitHub import failed:', err);
        let code = /^github_[a-z_]+$/.test(err.message) ? err.message : 'github_unavailable';
        // Профиль қосылмаған болса, «табылмады» көбіне жабық репо дегенді білдіреді
        if (code === 'github_not_found' && github.status?.configured && !github.status.connected) code = 'github_not_found_connect';
        if (code === 'github_token_invalid') github.refresh();
        setSourceError(t(`projectUpload.githubErrors.${code}`));
        setStage(scan ? 'review' : 'pick');
      });
  };

  const toggleRepos = () => {
    const next = !reposOpen;
    setReposOpen(next);
    if (!next || repos || reposLoading) return;
    setReposLoading(true);
    apiService
      .getGithubRepos()
      .then(setRepos)
      .catch((err: Error) => {
        console.error('GitHub repos failed:', err);
        setReposOpen(false);
        setSourceError(t('projectUpload.githubErrors.github_unavailable'));
      })
      .finally(() => setReposLoading(false));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (stage === 'uploading') return;
    const dt = e.dataTransfer;
    const zip = dt.files.length === 1 && /\.zip$/i.test(dt.files[0].name) ? dt.files[0] : null;
    // collectFromDrop entry-лерді синхронды алады — DataTransfer оқиғадан кейін тазаланады
    const dropped = collectFromDrop(dt);
    if (zip) load(() => collectFromZip(zip), 'projectUpload.zipError');
    else load(() => dropped, 'projectUpload.dropError');
  };

  const dragProps = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current++;
      setDragActive(true);
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragLeave: (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    },
    onDrop: handleDrop,
  };

  /* ----- Жүктеу ----- */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scan || !canSubmit) return;
    setStage('uploading');
    try {
      const res = await uploadFolder(files, {
        title: title.trim(),
        description: description.trim() || undefined,
        // Категориялар — Кодтар тізімі беті осы тегтер бойынша бөледі; негізгіден басқа тілдер — lang: тегі
        tags: [
          'folder',
          ...categories.map((c) => `${CATEGORY_TAG_PREFIX}${c}`),
          ...languages.slice(1).map((l) => `${LANGUAGE_TAG_PREFIX}${l}`),
        ],
        language: languages[0],
        isPrivate,
      });
      if (!res) {
        // Желі жоқ — жүктеу кезекке қойылды, хабарламасы error-да
        setStage('review');
        return;
      }
      if (onSuccess) {
        onSuccess(res.folderId);
        handleCloseAfterSuccess();
        return;
      }
      setResult(res);
      setStage('done');
    } catch {
      // Қате хабарламасы хуктың error-ында
      setStage('review');
    }
  };

  const handleCloseAfterSuccess = () => {
    resetAll();
    onClose();
  };

  const openProject = () => {
    if (!result) return;
    const id = result.folderId;
    resetAll();
    // Алдымен жобаға өтеміз, сосын жабамыз — /upload беті жабылғанда артқа қайтпауы үшін
    navigate(`/view/${id}`);
    onClose();
  };

  // Терминалдан жүктеу командасы — Баптаулар → Терминал (алдымен өтеміз, сосын жабамыз — openProject сияқты)
  const openTerminalSettings = () => {
    navigate('/settings/terminal');
    onClose();
  };

  /* ----- Бөліктер ----- */

  const pct = uploadProgress?.bytes ? Math.min(100, Math.round(((uploadProgress.loaded ?? 0) / uploadProgress.bytes) * 100)) : 0;
  const elapsedSec = uploadProgress ? (Date.now() - uploadProgress.startTime) / 1000 : 0;
  const speed = elapsedSec > 0.3 && uploadProgress?.loaded ? uploadProgress.loaded / elapsedSec : 0;

  const hiddenInputs = (
    <>
      <input
        ref={folderInputRef}
        type="file"
        hidden
        onChange={handleFolderInput}
        {...({ webkitdirectory: '', directory: '', multiple: true } as Record<string, unknown>)}
      />
      <input ref={zipInputRef} type="file" hidden accept=".zip,application/zip" onChange={handleZipInput} />
    </>
  );

  const pickButtons = (
    <div className="pu-pick__actions">
      <button type="button" className="pu-btn pu-btn--primary" onClick={pickFolder}>
        <FolderIcon size={16} /> {t('projectUpload.pickFolder')}
      </button>
      <button type="button" className="pu-btn pu-btn--ghost" onClick={() => zipInputRef.current?.click()}>
        <ArchiveIcon size={16} /> {t('projectUpload.pickZip')}
      </button>
    </div>
  );

  // Сілтеме өрісіндегі мәтін (сілтеме емес болса) репо тізімін сүзеді
  const repoQuery = githubUrl.includes('/') ? '' : githubUrl.trim().toLowerCase();
  const shownRepos = (repos ?? []).filter((r) => !repoQuery || r.fullName.toLowerCase().includes(repoQuery));

  const renderGithubAccount = () => {
    const status = github.status!;
    if (!status.connected) {
      return (
        <div className="pu-ghacc">
          <button type="button" className="pu-ghacc__link" onClick={github.connect} disabled={github.connecting}>
            <LockMark /> {t(github.connecting ? 'projectUpload.githubConnecting' : 'projectUpload.githubConnect')}
          </button>
        </div>
      );
    }
    return (
      <div className="pu-ghacc">
        <div className="pu-ghacc__bar">
          <span className="pu-ghacc__who"><GithubMark /> @{status.login}</span>
          <button type="button" className="pu-ghacc__link" onClick={toggleRepos} aria-expanded={reposOpen}>
            {t('projectUpload.githubMyRepos')}
            <span className={`pu-ghacc__chev ${reposOpen ? 'is-open' : ''}`}><ChevronIcon /></span>
          </button>
        </div>
        {reposOpen && (
          <ul className="pu-repos" aria-busy={reposLoading}>
            {reposLoading && <li className="pu-repos__empty">{t('common.loading')}</li>}
            {!reposLoading && shownRepos.length === 0 && <li className="pu-repos__empty">{t('projectUpload.noMatches')}</li>}
            {shownRepos.map((r) => (
              <li key={r.fullName}>
                <button type="button" className="pu-repos__item" onClick={() => importGithub(r.url)}>
                  <span className="pu-repos__name">{r.fullName}</span>
                  {r.private && <span className="pu-repos__lock" title={t('projectUpload.githubPrivate')}><LockMark /></span>}
                  {r.language && <span className="pu-repos__lang">{r.language}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  const renderPick = () => (
    <div className="pu-pick">
      <div className={`pu-drop ${dragActive ? 'is-active' : ''}`}>
        <div className="pu-drop__glyph"><ArrowUpIcon /></div>
        <p className="pu-drop__title">{t('projectUpload.dropTitle')}</p>
        {pickButtons}
      </div>

      <form className="pu-github" onSubmit={handleGithubSubmit}>
        <span className="pu-github__icon"><GithubMark /></span>
        <input
          className="pu-input pu-github__input"
          type="text"
          inputMode="url"
          value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)}
          placeholder={t('projectUpload.githubPlaceholder')}
          aria-label={t('projectUpload.githubLabel')}
          spellCheck={false}
          autoComplete="off"
        />
        <button type="submit" className="pu-btn pu-btn--primary pu-btn--sm" disabled={!githubUrl.trim()}>
          {t('projectUpload.githubImport')}
        </button>
      </form>

      {github.status?.configured && renderGithubAccount()}

      <div className="pu-pick__foot">
        <span><ShieldIcon size={13} /> {t('projectUpload.pickNote')}</span>
        <button type="button" className="pu-terminal" onClick={openTerminalSettings}>
          <code>codo push</code> <ArrowRightIcon />
        </button>
      </div>
    </div>
  );

  const renderScanning = () => <ScanningState />;

  // Желі жоқта жүктеу кезекке қойылады — бұл қате емес, ақпарат
  const errorTone: NoticeTone = error && error === t('fileUpload.uploadOfflineCached') ? 'info' : 'error';
  const dismissError = () => {
    setSourceError(null);
    reset();
  };

  const renderReview = () => {
    if (!scan) return null;
    const langTotal = scan.languages.reduce((s, l) => s + l.bytes, 0) || 1;
    const topLangs = scan.languages.slice(0, 6);
    // Жобада табылған код тілдері — тізімнің басында, үлесімен
    const detectedLangs = scan.languages
      .filter((l) => !SUPPORTING_LANGUAGES.has(l.name) && ALL_LANGUAGES.includes(l.name))
      .map((l) => l.name);
    const langShare = new Map(
      scan.languages.map((l) => {
        const pctShare = (l.bytes / langTotal) * 100;
        return [l.name, pctShare < 1 ? '<1' : Math.round(pctShare).toString()] as const;
      })
    );
    const missing = [
      !title.trim() && t('projectUpload.name'),
      !languages.length && t('projectUpload.languages'),
      !categories.length && t('projectUpload.category'),
    ].filter(Boolean);
    return (
      <form className="pu-review" onSubmit={handleSubmit}>
        <section className="pu-col pu-col--summary">
          <div className="pu-card pu-project">
            <span className="pu-project__icon"><FolderIcon size={22} /></span>
            <div className="pu-project__text">
              <strong title={scan.name}>{scan.name}</strong>
              <span>
                {t('projectUpload.filesCount', { count: files.length })} · {formatBytes(bytes)}
              </span>
            </div>
            <button type="button" className="pu-btn pu-btn--ghost pu-btn--sm" onClick={pickFolder}>
              {t('projectUpload.replace')}
            </button>
          </div>

          {topLangs.length > 0 && (
            <div className="pu-card">
              <div className="pu-card__label">{t('projectUpload.languages')}</div>
              <div className="pu-langbar" aria-hidden="true">
                {topLangs.map((l) => (
                  <span
                    key={l.name}
                    style={{ flexGrow: l.bytes / langTotal, background: LANGUAGE_COLORS[l.name] ?? 'var(--mono-737373)' }}
                  />
                ))}
              </div>
              <ul className="pu-langs">
                {topLangs.map((l) => (
                  <li key={l.name}>
                    <i style={{ background: LANGUAGE_COLORS[l.name] ?? 'var(--mono-737373)' }} />
                    {l.name}
                    <span>{((l.bytes / langTotal) * 100).toFixed(l.bytes / langTotal < 0.1 ? 1 : 0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={`pu-card pu-clean ${scan.junkFiles || scan.junkSources.length ? '' : 'is-clean'}`}>
            <div className="pu-card__label">
              <TrashIcon size={14} /> {t('projectUpload.removedTitle')}
            </div>
            {scan.junkFiles || scan.junkSources.length ? (
              <>
                <p className="pu-clean__sum">
                  {scan.junkFiles > 0
                    ? t('projectUpload.removedSummary', { count: scan.junkFiles, size: formatBytes(scan.junkBytes) })
                    : t('projectUpload.removedFolders')}
                </p>
                <div className="pu-chips">
                  {scan.junkSources.slice(0, 8).map((s) => (
                    <span key={s.name} className="pu-chip">
                      {s.name}
                      {s.bytes > 0 && <em>{formatBytes(s.bytes)}</em>}
                    </span>
                  ))}
                  {scan.junkSources.length > 8 && <span className="pu-chip">+{scan.junkSources.length - 8}</span>}
                </div>
              </>
            ) : (
              <p className="pu-clean__sum"><CheckIcon /> {t('projectUpload.removedNone')}</p>
            )}
          </div>

          {scan.protectedFiles.length > 0 && (
            <ProtectedFiles files={scan.protectedFiles} sizes={protectedSizes} excluded={excluded} onToggle={toggleProtected} />
          )}

          {files.length > 0 && (
            <div className="pu-card pu-structure">
              <div className="pu-card__label">{t('projectUpload.structure')}</div>
              <div className="pu-structure__scroll">
                <TreeRows
                  nodes={tree}
                  depth={0}
                  open={openDirs}
                  onToggle={(p) =>
                    setOpenDirs((prev) => {
                      const next = new Set(prev);
                      if (next.has(p)) next.delete(p);
                      else next.add(p);
                      return next;
                    })
                  }
                />
              </div>
            </div>
          )}
        </section>

        <section className="pu-col pu-col--form">
          <label className="pu-field">
            <span>{t('projectUpload.name')}<i className="pu-req" aria-hidden="true">*</i></span>
            <input
              className="pu-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('projectUpload.namePlaceholder')}
              maxLength={120}
              required
            />
          </label>

          <fieldset className="pu-field pu-pickset">
            <legend>
              {t('projectUpload.languages')}<i className="pu-req" aria-hidden="true">*</i>
            </legend>
            <MultiSelect
              options={[...new Set([...detectedLangs, ...ALL_LANGUAGES])].map((l) => ({
                value: l,
                label: l,
                lead: <i className="pu-check__dot" style={{ background: LANGUAGE_COLORS[l] ?? 'var(--mono-737373)' }} />,
                meta: langShare.has(l) ? `${langShare.get(l)}%` : undefined,
                group: detectedLangs.includes(l) ? t('projectUpload.detectedGroup') : t('projectUpload.moreLanguages'),
              }))}
              selected={languages}
              onToggle={(v) => toggleIn(setLanguages, v)}
              placeholder={t('projectUpload.selectLanguages')}
              searchPlaceholder={t('projectUpload.searchLanguage')}
              chipBadge={(v) => languages[0] === v && languages.length > 1 && <em className="pu-check__tag">{t('projectUpload.primary')}</em>}
            />
          </fieldset>

          <fieldset className="pu-field pu-pickset">
            <legend>
              {t('projectUpload.category')}<i className="pu-req" aria-hidden="true">*</i>
            </legend>
            <MultiSelect
              options={DIRECTIONS.map((d) => ({
                value: d.value,
                label: t(d.key),
                lead: <span className="pu-check__icon">{d.icon}</span>,
                badge: autoCategories.includes(d.value) ? <em className="pu-auto">{t('projectUpload.auto')}</em> : undefined,
              }))}
              selected={categories}
              onToggle={(v) => toggleIn(setCategories, v)}
              placeholder={t('projectUpload.selectDirections')}
            />
          </fieldset>

          <label className="pu-field pu-field--grow">
            <span>{t('projectUpload.description')}</span>
            <textarea
              className="pu-input pu-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('projectUpload.descriptionPlaceholder')}
              rows={4}
              maxLength={500}
            />
          </label>

          <label className={`pu-visibility ${isPrivate ? 'is-on' : ''}`}>
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            <span className="pu-check__box" aria-hidden="true">{isPrivate && <CheckIcon />}</span>
            <span className="pu-visibility__text">
              <strong><LockMark /> {t('projectVisibility.private')}</strong>
              <small>{t(isPrivate ? 'projectVisibility.privateHint' : 'projectVisibility.publicHint')}</small>
            </span>
          </label>

          {files.length === 0 && <Notice tone="warn" message={t('projectUpload.emptyProject')} />}
          {(error || sourceError) && (
            <Notice tone={error ? errorTone : 'error'} message={(error || sourceError)!} onDismiss={dismissError} />
          )}

          <button type="submit" className="pu-btn pu-btn--primary pu-btn--block" disabled={!canSubmit}>
            <ArrowUpIcon /> {t('projectUpload.submit', { count: files.length })}
          </button>
          {missing.length > 0 && files.length > 0 && (
            <p className="pu-missing">{t('projectUpload.fillRequired', { fields: missing.join(', ') })}</p>
          )}
        </section>
      </form>
    );
  };

  const renderUploading = () => {
    const sent = pct >= 100;
    return (
      <div className="pu-state">
        <div
          className={`pu-ring ${sent ? 'is-thinking' : ''}`}
          style={{ ['--pu-pct' as string]: `${pct}` } as React.CSSProperties}
        >
          <span>{sent ? <CodeBracketsIcon /> : `${pct}%`}</span>
        </div>
        <p className="pu-state__title pu-shimmer">{t(sent ? 'projectUpload.processing' : 'projectUpload.uploading')}</p>
        <p className="pu-state__meta">
          {uploadProgress?.bytes
            ? `${formatBytes(uploadProgress.loaded ?? 0)} / ${formatBytes(uploadProgress.bytes)}`
            : t('projectUpload.filesCount', { count: files.length })}
          {!sent && speed > 0 && ` · ${formatBytes(speed)}/s`}
        </p>
        {sent ? <ServerThinking /> : <ThinkingSteps steps={UPLOAD_STEPS} active={0} />}
      </div>
    );
  };

  const renderDone = () => (
    <div className="pu-state">
      <div className="pu-done"><CheckIcon /></div>
      <p className="pu-state__title">{t('projectUpload.doneTitle')}</p>
      <p className="pu-state__meta">{t('projectUpload.doneSummary', { count: result?.created ?? 0 })}</p>
      {!!result?.failed && (
        <div className="pu-card pu-warn pu-done__failed">
          <div className="pu-card__label">{t('projectUpload.failedTitle', { count: result.failed })}</div>
          <div className="pu-chips">
            {result.failedFiles.slice(0, 10).map((f) => <span key={f} className="pu-chip">{innerPath(f)}</span>)}
            {result.failedFiles.length > 10 && <span className="pu-chip">+{result.failedFiles.length - 10}</span>}
          </div>
        </div>
      )}
      <div className="pu-pick__actions">
        <button type="button" className="pu-btn pu-btn--primary" onClick={openProject}>
          {t('projectUpload.openProject')} <ArrowRightIcon />
        </button>
        <button type="button" className="pu-btn pu-btn--ghost" onClick={resetAll}>
          {t('projectUpload.uploadAnother')}
        </button>
        {/* Жүктеу басылған бетте қаламыз */}
        <button type="button" className="pu-btn pu-btn--ghost" onClick={handleCloseAfterSuccess}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="pu-overlay" onMouseDown={(e) => e.target === e.currentTarget && handleClose()}>
      <div
        className={`pu-modal ${stage === 'review' ? 'is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pu-title"
        {...dragProps}
      >
        <header className="pu-head">
          <h2 id="pu-title">{t('projectUpload.title')}</h2>
          <button type="button" className="pu-close" onClick={handleClose} disabled={uploading} aria-label={t('common.close', 'Close')}>
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="pu-body">
          {stage === 'pick' && renderPick()}
          {stage === 'scanning' && renderScanning()}
          {stage === 'review' && renderReview()}
          {stage === 'uploading' && renderUploading()}
          {stage === 'done' && renderDone()}
          {stage === 'pick' && sourceError && (
            <Notice tone="error" message={sourceError} onDismiss={() => setSourceError(null)} />
          )}
        </div>

        {dragActive && stage === 'review' && (
          <div className="pu-dropmask"><ArrowUpIcon /> {t('projectUpload.dropReplace')}</div>
        )}
        {primeOpen && <FolderPrime onContinue={continueFromPrime} onCancel={() => setPrimeOpen(false)} />}
        {hiddenInputs}
      </div>
    </div>
  );
};

export default UploadModal;
