import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useFileUpload, FolderUploadResult } from '../../hooks/useFileUpload';
import { CATEGORY_TAG_PREFIX } from '../../utils/codeCategories';
import { innerPath } from '../../utils/uploadRules';
import {
  CollectedProject,
  MAX_PROJECT_BYTES,
  MAX_PROJECT_FILES,
  PreviewNode,
  ProjectScan,
  buildPreviewTree,
  collectFromDrop,
  collectFromInput,
  collectFromZip,
  formatBytes,
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
  FileIcon,
  FolderIcon,
  ShieldIcon,
  TrashIcon,
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

const CATEGORY_GROUPS: { label: string; options: { value: string; key: string }[] }[] = [
  {
    label: 'uploadModal.categoryAI',
    options: [
      { value: 'machine-learning', key: 'uploadModal.categoryAIOption1' },
      { value: 'natural-language-processing', key: 'uploadModal.categoryAIOption2' },
      { value: 'computer-vision', key: 'uploadModal.categoryAIOption3' },
      { value: 'ai-applications', key: 'uploadModal.categoryAIOption4' },
    ],
  },
  {
    label: 'uploadModal.categoryMobile',
    options: [
      { value: 'ios-app', key: 'uploadModal.categoryMobileOption1' },
      { value: 'android-app', key: 'uploadModal.categoryMobileOption2' },
      { value: 'cross-platform-app', key: 'uploadModal.categoryMobileOption3' },
      { value: 'mobile-game', key: 'uploadModal.categoryMobileOption4' },
    ],
  },
  {
    label: 'uploadModal.categoryOther',
    options: [
      { value: 'web-app', key: 'uploadModal.categoryOtherOption1' },
      { value: 'desktop-app', key: 'uploadModal.categoryOtherOption2' },
      { value: 'game', key: 'uploadModal.categoryOtherOption3' },
      { value: 'api', key: 'uploadModal.categoryOtherOption4' },
      { value: 'database', key: 'uploadModal.categoryOtherOption5' },
      { value: 'devops', key: 'uploadModal.categoryOtherOption6' },
      { value: 'other', key: 'uploadModal.categoryOtherOption7' },
    ],
  },
];

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
  const [result, setResult] = useState<FolderUploadResult | null>(null);

  const [title, setTitle] = useState('');
  const [language, setLanguage] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const tree = useMemo(() => (scan ? buildPreviewTree(scan.files) : []), [scan]);
  const tooLarge = !!scan && scan.bytes > MAX_PROJECT_BYTES;
  const tooMany = !!scan && scan.files.length > MAX_PROJECT_FILES;
  const canSubmit = !!scan && scan.files.length > 0 && !tooLarge && !tooMany && !!title.trim() && !!language && !!category && !uploading;

  const resetAll = useCallback(() => {
    setStage('pick');
    setScan(null);
    setResult(null);
    setSourceError(null);
    setOpenDirs(new Set());
    setTitle('');
    setLanguage('');
    setCategory('');
    setDescription('');
    reset();
  }, [reset]);

  const handleClose = useCallback(() => {
    if (uploading) return;
    resetAll();
    onClose();
  }, [uploading, resetAll, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

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
      // Ағаш жабық басталады: тек бірінші деңгей көрінеді
      setOpenDirs(new Set());
      setTitle((prev) => prev || next.name);
      setLanguage(next.mainLanguage);
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

  const handleZipInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) load(() => collectFromZip(file), 'projectUpload.zipError');
    e.target.value = '';
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
      const res = await uploadFolder(scan.files, {
        title: title.trim(),
        description: description.trim() || category,
        // Таңдалған категория — Кодтар тізімі беті осы тег бойынша бөледі
        tags: ['folder', `${CATEGORY_TAG_PREFIX}${category}`],
        language,
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
    handleCloseAfterSuccess();
    navigate(`/view/${id}`);
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
      <button type="button" className="pu-btn pu-btn--primary" onClick={() => folderInputRef.current?.click()}>
        <FolderIcon size={16} /> {t('projectUpload.pickFolder')}
      </button>
      <button type="button" className="pu-btn pu-btn--ghost" onClick={() => zipInputRef.current?.click()}>
        <ArchiveIcon size={16} /> {t('projectUpload.pickZip')}
      </button>
    </div>
  );

  const renderPick = () => (
    <div className={`pu-drop ${dragActive ? 'is-active' : ''}`}>
      <div className="pu-drop__glyph"><ArrowUpIcon /></div>
      <h3 className="pu-drop__title">{t('projectUpload.dropTitle')}</h3>
      <p className="pu-drop__hint">{t('projectUpload.dropHint')}</p>
      {pickButtons}
      <ul className="pu-rules">
        <li className="is-ok"><CodeBracketsIcon /> {t('projectUpload.ruleCode')}</li>
        <li className="is-off"><TrashIcon size={15} /> {t('projectUpload.ruleJunk')}</li>
        <li className="is-off"><ShieldIcon size={15} /> {t('projectUpload.ruleSecret')}</li>
      </ul>
    </div>
  );

  const renderScanning = () => (
    <div className="pu-state">
      <span className="pu-spinner" aria-hidden="true" />
      <p>{t('projectUpload.scanning')}</p>
    </div>
  );

  const renderReview = () => {
    if (!scan) return null;
    const langTotal = scan.languages.reduce((s, l) => s + l.bytes, 0) || 1;
    const topLangs = scan.languages.slice(0, 6);
    return (
      <form className="pu-review" onSubmit={handleSubmit}>
        <section className="pu-col pu-col--summary">
          <div className="pu-card pu-project">
            <span className="pu-project__icon"><FolderIcon size={22} /></span>
            <div className="pu-project__text">
              <strong title={scan.name}>{scan.name}</strong>
              <span>
                {t('projectUpload.filesCount', { count: scan.files.length })} · {formatBytes(scan.bytes)}
              </span>
            </div>
            <button type="button" className="pu-btn pu-btn--ghost pu-btn--sm" onClick={() => folderInputRef.current?.click()}>
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

          {scan.skipped.length > 0 && (
            <div className="pu-card pu-warn">
              <div className="pu-card__label"><ShieldIcon size={14} /> {t('projectUpload.skippedTitle')}</div>
              <div className="pu-chips">
                {scan.skipped.slice(0, 8).map((s) => (
                  <span key={s.path} className="pu-chip">{innerPath(s.path)}</span>
                ))}
                {scan.skipped.length > 8 && <span className="pu-chip">+{scan.skipped.length - 8}</span>}
              </div>
            </div>
          )}

          {scan.files.length > 0 && (
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
            <span>{t('projectUpload.name')}</span>
            <input
              className="pu-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('projectUpload.namePlaceholder')}
              maxLength={120}
              required
            />
          </label>

          <label className="pu-field">
            <span>
              {t('projectUpload.language')}
              {scan.mainLanguage === language && <em className="pu-auto">{t('projectUpload.auto')}</em>}
            </span>
            <select className="pu-input" value={language} onChange={(e) => setLanguage(e.target.value)} required>
              {Object.entries(LANGUAGE_GROUPS).map(([group, langs]) => (
                <optgroup key={group} label={group}>
                  {langs.map((l) => <option key={l} value={l}>{l}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

          <label className="pu-field">
            <span>{t('projectUpload.category')}</span>
            <select className="pu-input" value={category} onChange={(e) => setCategory(e.target.value)} required>
              <option value="">{t('uploadModal.selectCategory')}</option>
              {CATEGORY_GROUPS.map((g) => (
                <optgroup key={g.label} label={t(g.label)}>
                  {g.options.map((o) => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
                </optgroup>
              ))}
            </select>
          </label>

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

          {scan.files.length === 0 && <div className="pu-alert">{t('projectUpload.emptyProject')}</div>}
          {tooLarge && (
            <div className="pu-alert">
              {t('projectUpload.tooLarge', { size: formatBytes(scan.bytes), max: formatBytes(MAX_PROJECT_BYTES) })}
            </div>
          )}
          {tooMany && (
            <div className="pu-alert">
              {t('projectUpload.tooManyFiles', { count: scan.files.length, max: MAX_PROJECT_FILES })}
            </div>
          )}
          {(error || sourceError) && <div className="pu-alert">{error || sourceError}</div>}

          <button type="submit" className="pu-btn pu-btn--primary pu-btn--block" disabled={!canSubmit}>
            <ArrowUpIcon /> {t('projectUpload.submit', { count: scan.files.length })}
          </button>
        </section>
      </form>
    );
  };

  const renderUploading = () => (
    <div className="pu-state">
      <div className="pu-ring" style={{ ['--pu-pct' as string]: `${pct}` } as React.CSSProperties}>
        <span>{pct}%</span>
      </div>
      <p className="pu-state__title">{t('projectUpload.uploading')}</p>
      <p className="pu-state__meta">
        {uploadProgress?.bytes
          ? `${formatBytes(uploadProgress.loaded ?? 0)} / ${formatBytes(uploadProgress.bytes)}`
          : t('projectUpload.filesCount', { count: scan?.files.length ?? 0 })}
        {speed > 0 && ` · ${formatBytes(speed)}/s`}
      </p>
      {pct >= 100 && <p className="pu-state__meta">{t('projectUpload.processing')}</p>}
    </div>
  );

  const renderDone = () => (
    <div className="pu-state">
      <div className="pu-done"><CheckIcon /></div>
      <p className="pu-state__title">{t('projectUpload.doneTitle')}</p>
      <p className="pu-state__meta">{t('projectUpload.doneSummary', { count: result?.created ?? 0 })}</p>
      {result && (
        <p className="pu-state__meta">
          {t('projectUpload.doneTiming', {
            total: result.totalSeconds.toFixed(1),
            server: (result.serverMs / 1000).toFixed(1),
          })}
        </p>
      )}
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
          <div>
            <h2 id="pu-title">{t('projectUpload.title')}</h2>
            <p>{t('projectUpload.subtitle')}</p>
          </div>
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
          {stage === 'pick' && sourceError && <div className="pu-alert">{sourceError}</div>}
        </div>

        {dragActive && stage === 'review' && (
          <div className="pu-dropmask"><ArrowUpIcon /> {t('projectUpload.dropReplace')}</div>
        )}
        {hiddenInputs}
      </div>
    </div>
  );
};

export default UploadModal;
