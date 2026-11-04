import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { apiService } from '../../utils/api';
import { CheckIcon, CloseIcon, CopyIcon, GlobeIcon } from './icons';
import './PublishButton.css';

/* «Сайтқа жариялау» — Vibecoding-тегі жобаны Жобалар бетіне бір басумен шығару.
   Бір рет жарияланса — батырма «Сайтта жаңарту» болады: жаңа көшірме жасалмайды,
   сол жазба (сілтемесі, лайктары, пікірлері) жаңарады. */

type Result = {
  codeId: string;
  updated: boolean;
  failedFiles: string[];
  skipped: string[];
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PublishButton: React.FC = () => {
  const { t } = useTranslation();
  const { activeProject, dispatch, flushProjects, saveErrors } = useVibecoding();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const publishRef = useRef<HTMLButtonElement>(null);

  const published = !!activeProject?.publishedCodeId;
  const saveError = activeProject ? saveErrors[activeProject.id] : undefined;
  const fileCount = activeProject?.files.length ?? 0;

  // Жоба ауысса — диалог жабылады
  useEffect(() => {
    setOpen(false);
  }, [activeProject?.id]);

  // Ашылғанда — атауы алдын ала толтырылады, Enter басса бірден жарияланады
  useEffect(() => {
    if (!open || !activeProject) return;
    setTitle(activeProject.name);
    setDescription('');
    setVisibility(null);
    setError(null);
    setResult(null);
    setCopied(false);
    const id = window.setTimeout(() => publishRef.current?.focus(), 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Сыртқа басқанда / Esc — жабылады
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!activeProject) return null;

  const publish = async () => {
    if (busy || !fileCount) return;
    setBusy(true);
    setError(null);
    try {
      // Редактордағы соңғы өзгерістер алдымен серверге жетсін
      await flushProjects();
      const res = await apiService.publishVibecodingProject(activeProject.id, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        ...(visibility && { isPrivate: visibility === 'private' }),
      });
      dispatch({ type: 'SET_PUBLISHED', payload: { projectId: activeProject.id, codeId: res.codeId } });
      apiService.invalidateCodesCache();
      setResult({ codeId: res.codeId, updated: !!res.updated, failedFiles: res.failedFiles ?? [], skipped: res.skipped ?? [] });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const viewPath = result ? `/view/${result.codeId}` : activeProject.publishedCodeId ? `/view/${activeProject.publishedCodeId}` : null;

  const copyLink = () => {
    if (!viewPath) return;
    navigator.clipboard?.writeText(`${window.location.origin}${viewPath}`).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const label = published ? t('vibecoding.publish.update', 'Сайтта жаңарту') : t('vibecoding.publish.button', 'Сайтқа жариялау');

  return (
    <div className="vx-pub" ref={wrapRef}>
      <button
        type="button"
        className={`vx-pub__trigger ${published ? 'is-published' : ''} ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={published
          ? t('vibecoding.publish.updateHint', 'Жобалар бетіндегі нұсқасын осы кодпен жаңарту')
          : t('vibecoding.publish.hint', 'Жобаны Жобалар бетіне шығару — басқалар көріп, жүктей алады')}
      >
        <GlobeIcon size={13} />
        <span className="vx-pub__label">{label}</span>
      </button>

      {open && (
        <div className="vx-pub__pop" role="dialog" aria-label={label}>
          <div className="vx-pub__head">
            <b>{label}</b>
            <button type="button" className="vx-pub__x" onClick={() => setOpen(false)} aria-label={t('common.close', 'Жабу')}>
              <CloseIcon size={11} />
            </button>
          </div>

          {result ? (
            <div className="vx-pub__done">
              <p className="vx-pub__ok">
                <CheckIcon size={13} />
                {result.updated
                  ? t('vibecoding.publish.updated', 'Жобалар бетінде жаңартылды')
                  : t('vibecoding.publish.published', 'Жобалар бетіне жарияланды')}
              </p>
              {(result.failedFiles.length > 0 || result.skipped.length > 0) && (
                <p className="vx-pub__warn">
                  {t('vibecoding.publish.skipped', 'Жарияланбаған файлдар ({{count}}): құпия (.env), бинарлы немесе рұқсат етілмеген түрлер.', {
                    count: result.failedFiles.length + result.skipped.length,
                  })}
                  {' '}
                  <span className="vx-pub__files">{[...result.skipped, ...result.failedFiles].slice(0, 5).join(', ')}</span>
                </p>
              )}
              <div className="vx-pub__row">
                <Link to={viewPath!} className="vx-pub__primary" onClick={() => setOpen(false)}>
                  {t('vibecoding.publish.open', 'Жобалар бетінде ашу')}
                </Link>
                <button type="button" className="vx-pub__ghost" onClick={copyLink}>
                  {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                  {copied ? t('vibecoding.publish.copied', 'Көшірілді') : t('vibecoding.publish.copy', 'Сілтеме')}
                </button>
              </div>
            </div>
          ) : (
            <form
              className="vx-pub__form"
              onSubmit={(e) => {
                e.preventDefault();
                void publish();
              }}
            >
              <label className="vx-pub__field">
                <span>{t('vibecoding.publish.title', 'Атауы')}</span>
                <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label className="vx-pub__field">
                <span>{t('vibecoding.publish.description', 'Сипаттама')} <i>{t('vibecoding.publish.optional', 'міндетті емес')}</i></span>
                <textarea
                  value={description}
                  rows={2}
                  maxLength={2000}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={published ? t('vibecoding.publish.keepDescription', 'Бос қалса — бұрынғы сипаттама сақталады') : ''}
                />
              </label>
              <div className="vx-pub__seg" role="radiogroup" aria-label={t('vibecoding.publish.visibility', 'Кімге көрінеді')}>
                <button type="button" className={visibility === 'public' ? 'is-on' : ''} onClick={() => setVisibility('public')}>
                  {t('vibecoding.publish.public', 'Барлығына')}
                </button>
                <button type="button" className={visibility === 'private' ? 'is-on' : ''} onClick={() => setVisibility('private')}>
                  {t('vibecoding.publish.private', 'Тек маған')}
                </button>
              </div>
              {visibility === null && (
                <p className="vx-pub__note">
                  {published
                    ? t('vibecoding.publish.keepVisibility', 'Таңдамасаңыз — көрінуі бұрынғыдай қалады')
                    : t('vibecoding.publish.defaultVisibility', 'Таңдамасаңыз — профильдегі әдепкі баптау қолданылады')}
                </p>
              )}
              {saveError && (
                <p className="vx-pub__warn">{t('vibecoding.publish.notSaved', 'Жоба серверге сақталмай тұр: {{reason}}', { reason: saveError })}</p>
              )}
              {!fileCount && <p className="vx-pub__warn">{t('vibecoding.publish.empty', 'Жоба бос — алдымен файл қосыңыз')}</p>}
              {error && <p className="vx-pub__error">{error}</p>}
              <div className="vx-pub__row">
                <button ref={publishRef} type="submit" className="vx-pub__primary" disabled={busy || !fileCount}>
                  <GlobeIcon size={12} />
                  {busy ? t('vibecoding.publish.busy', 'Жариялануда…') : published ? t('vibecoding.publish.updateShort', 'Жаңарту') : t('vibecoding.publish.go', 'Жариялау')}
                </button>
                {published && viewPath && (
                  <Link to={viewPath} className="vx-pub__ghost" onClick={() => setOpen(false)}>
                    {t('vibecoding.publish.openShort', 'Ашу')}
                  </Link>
                )}
              </div>
              <p className="vx-pub__note">
                {published
                  ? t('vibecoding.publish.updateNote', 'Сілтеме, лайктар мен пікірлер сақталады — тек код жаңарады.')
                  : t('vibecoding.publish.note', 'Жоба Жобалар бетінде шығады: басқалар көріп, іске қосып, жүктей алады.')}
              </p>
              <p className="vx-pub__note vx-pub__git">
                {t('vibecoding.publish.gitNote', 'Бұл — Жобалар бетіне шығару. Нұсқалар тарихын сақтау (Git) бөлек: Git панеліндегі «Сайт Git-іне сақтау».')}
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default PublishButton;
