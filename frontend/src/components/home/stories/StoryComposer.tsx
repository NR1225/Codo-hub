import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faXmark, faImage, faFolder, faCode, faCheck, faMagnifyingGlass, faArrowsRotate, faPaperPlane, faChevronDown, faLink,
  faPlus, faGraduationCap, faPalette,
} from '@fortawesome/free-solid-svg-icons';
import { apiService, CodeFile, StoryItem, UploadAbortedError } from '../../../utils/api';
import { useAuth } from '../../../contexts/AuthContext';
import StoryMentionPicker from './StoryMentionPicker';
import UploadModal from '../../modals/UploadModal';
import {
  ACCEPT_MEDIA, CAPTION_MAX, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS,
  STORY_BACKGROUNDS, BACKGROUND_IDS, randomBackground, mentionReady, type MentionValue,
} from './storyUtils';

/* Жаңа сторис: фото/видео + жазу + «Жобаға өту» үшін Codo Hub-тағы өз жобаңды таңдау.
   Сілтеме тек сайттағы жобаға — сервер де тексереді (services/story_service.py).
   Шағымда жоба міндетті емес. Жобасы жоқ адам осы терезеден шықпай жоба жүктей алады —
   жүктелген жоба бірден таңдалады, жазылған сторис жоғалмайды */

interface Props {
  projects: CodeFile[];
  onClose: () => void;
  onCreated: (story: StoryItem) => void;
}

const StoryComposer: React.FC<Props> = ({ projects: initialProjects, onClose, onCreated }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Сторис түрі: фото/видео не түсті фон (әр жолы басқа фонмен басталады).
  // Ауысқанда екінші жақтағы таңдау жоғалмайды — қайта ауысса орнында тұр
  const [mode, setMode] = useState<'photo' | 'bg'>('photo');
  const [background, setBackground] = useState(randomBackground);
  const [caption, setCaption] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mention, setMention] = useState<MentionValue | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ddOpen, setDdOpen] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<CodeFile[]>(initialProjects);
  const [uploadOpen, setUploadOpen] = useState(false);
  const complaint = mention?.kind === 'complaint';

  // Басты беттегі тізім тек соңғы кодтар — өз жобаларымның бәрін бөлек аламыз
  const loadProjects = async (): Promise<CodeFile[]> => {
    if (!user) return [];
    try {
      const res = await apiService.getCodeFiles(undefined, 1000, 0, false);
      const mine = res.codes.filter((c) => c.author === user.username && !c.folderId);
      setProjects(mine);
      return mine;
    } catch {
      return projects;
    }
  };

  useEffect(() => {
    loadProjects();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Осы терезеден жүктелген жаңа жоба — бірден таңдалады
  const onProjectUploaded = async () => {
    apiService.invalidateCodesCache();
    const before = new Set(projects.map((p) => p.id));
    const mine = await loadProjects();
    const fresh = mine.filter((p) => !before.has(p.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (fresh) setProjectId(fresh.id);
  };

  // Dropdown-нан тыс басқанда жабу
  useEffect(() => {
    if (!ddOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!ddRef.current?.contains(e.target as Node)) setDdOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [ddOpen]);

  // Таңдалған жобаны қайта басу — алып тастау (шағымда жоба міндетті емес)
  const chooseProject = (id: string) => {
    setProjectId((cur) => (cur === id ? null : id));
    setDdOpen(false);
    setQuery('');
  };

  const isVideo = !!file?.type.startsWith('video/');
  const uploading = progress !== null;

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Жоба жүктеу терезесі ашық болса — Escape соған тиесілі
      if (e.key !== 'Escape' || uploading || uploadOpen) return;
      // Алдымен ашық dropdown жабылады
      if (ddRef.current?.querySelector('.sc__dd-menu')) setDdOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, uploading, uploadOpen]);

  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return q ? list.filter((p) => p.title.toLowerCase().includes(q) || p.language?.toLowerCase().includes(q)) : list;
  }, [projects, query]);

  const pickFile = (picked: File | undefined) => {
    if (!picked) return;
    setError(null);
    if (!ACCEPT_MEDIA.split(',').includes(picked.type)) {
      setError(t('home.story.errType'));
      return;
    }
    const video = picked.type.startsWith('video/');
    const limit = video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (picked.size > limit) {
      setError(t('home.story.errSize', { mb: limit / (1024 * 1024) }));
      return;
    }
    const url = URL.createObjectURL(picked);
    if (video) {
      // Ұзақтығын тексеру
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        if (probe.duration > MAX_VIDEO_SECONDS + 0.5) {
          URL.revokeObjectURL(url);
          setError(t('home.story.errDuration', { sec: MAX_VIDEO_SECONDS }));
          return;
        }
        setFile(picked);
        setPreview(url);
        setMode('photo');
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        setError(t('home.story.errType'));
      };
      probe.src = url;
      return;
    }
    setFile(picked);
    setPreview(url);
    setMode('photo');
  };

  // Міндеттісі: фото/видео (не түсті фон). Жазу — тек түсті фонда және адам белгіленгенде
  // (пікірдің өзі — жазу), белгіленсе пікір түрі де керек. Жоба — әрқашан қалауынша
  const captionRequired = mode === 'bg';
  const steps = [
    ...(mode === 'photo' ? [{ key: 'media', done: !!file, label: t('home.story.stepMedia') }] : []),
    ...(captionRequired ? [{ key: 'caption', done: caption.trim().length > 0, label: t('home.story.stepCaption') }] : []),
    ...(mention ? [{ key: 'kind', done: mentionReady(mention), label: t('home.story.stepOpinion') }] : []),
  ];
  const ready = steps.every((s) => s.done);

  // Қадамды басқанда — сол өріске апарады (не толтыру керегін үйретеді)
  const goToStep = (key: string) => {
    if (uploading) return;
    if (key === 'media') inputRef.current?.click();
    else if (key === 'caption') captionRef.current?.focus();
    else if (key === 'kind') mentionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (key === 'project') {
      if (projects.length === 0) setUploadOpen(true);
      else {
        ddRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setDdOpen(true);
      }
    }
  };

  const publish = async () => {
    if (!ready || uploading) return;
    setError(null);
    setProgress(0);
    abortRef.current = new AbortController();
    try {
      const story = await apiService.createStory(
        {
          file: mode === 'photo' ? file : null,
          background: mode === 'bg' ? background : undefined,
          caption: caption.trim(),
          projectId,
          mentionId: mention?.user.id,
          mentionKind: mention?.kind ?? undefined,
          mentionText: mention?.text.trim(),
          ...(complaint && mention ? {
            evidence: mention.evidence.trim(),
            evidenceProjectId: mention.projectId,
            reviewToken: mention.review?.token,
            manualReview: !!mention.manual && !mention.review?.accepted,
          } : {}),
        },
        { onProgress: setProgress, signal: abortRef.current.signal }
      );
      onCreated(story);
    } catch (e) {
      if (!(e instanceof UploadAbortedError)) setError(e instanceof Error ? e.message : t('home.story.errUpload'));
      setProgress(null);
    }
  };

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };

  const selected = projects.find((p) => p.id === projectId);

  // body-ға шығарамыз — хедер (z-index 9999) үстінен
  return createPortal(
    <div className="sc" role="dialog" aria-modal="true" aria-label={t('home.story.newTitle')} onClick={close}>
      <div className="sc__panel" onClick={(e) => e.stopPropagation()}>
        <header className="sc__head">
          <h2>{t('home.story.newTitle')}</h2>
          <button type="button" className="sc__icon" onClick={close} aria-label={t('home.storyClose')}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>

        <div className="sc__body">
          {/* Сол жақ — түрін таңдау (Фото/видео | Түсті фон) + 9:16 алдын ала көрініс */}
          <div className="sc__media-col">
          <div className="sc__mode" role="tablist" aria-label={t('home.story.newTitle')}>
            <button type="button" role="tab" aria-selected={mode === 'photo'} disabled={uploading}
              className={`sc__mode-btn ${mode === 'photo' ? 'is-on' : ''}`} onClick={() => setMode('photo')}>
              <FontAwesomeIcon icon={faImage} />
              {t('home.story.stepMedia')}
            </button>
            <button type="button" role="tab" aria-selected={mode === 'bg'} disabled={uploading}
              className={`sc__mode-btn ${mode === 'bg' ? 'is-on' : ''}`} onClick={() => setMode('bg')}>
              <FontAwesomeIcon icon={faPalette} />
              {t('home.story.modeBackground')}
            </button>
          </div>
          <div
            className={`sc__media ${dragging ? 'is-drag' : ''} ${mode === 'photo' && preview ? 'has-file' : ''} ${mode === 'bg' ? 'is-bg' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}
          >
            {mode === 'photo' && preview ? (
              <>
                {isVideo
                  ? <video src={preview} className="sc__preview" autoPlay muted loop playsInline />
                  : <img src={preview} className="sc__preview" alt="" />}
                {mention?.kind && (
                  <span className={`sc__preview-mention is-${mention.kind}`}>
                    {mention.kind === 'praise' ? '👍' : '⚠️'} @{mention.user.username}
                  </span>
                )}
                {caption.trim() && <p className="sc__preview-caption">{caption}</p>}
                {selected && (
                  <span className="sc__preview-cta">
                    <FontAwesomeIcon icon={selected.isFolder ? faFolder : faCode} />
                    {selected.title}
                  </span>
                )}
                {!uploading && (
                  <button type="button" className="sc__replace" onClick={() => inputRef.current?.click()}>
                    <FontAwesomeIcon icon={faArrowsRotate} />
                    {t('home.story.replace')}
                  </button>
                )}
              </>
            ) : mode === 'photo' ? (
              <button type="button" className="sc__drop" onClick={() => inputRef.current?.click()}>
                <span className="sc__drop-icon"><FontAwesomeIcon icon={faImage} /></span>
                <strong>{t('home.story.pickMedia')}</strong>
                <small>{t('home.story.mediaHint', { sec: MAX_VIDEO_SECONDS })}</small>
                <small className="sc__drop-alt">{t('home.story.orBackground')}</small>
              </button>
            ) : (
              /* Түсті фондағы мәтін — фонды жоғарыдағы шеңберлерден ауыстырады */
              <div className="sc__textstory" style={{ background: STORY_BACKGROUNDS[background] }}>
                <div className="sc__bg-row" role="radiogroup" aria-label={t('home.story.background')}>
                  {BACKGROUND_IDS.map((id) => (
                    <button key={id} type="button" role="radio" aria-checked={background === id} aria-label={id}
                      className={`sc__bg ${background === id ? 'is-on' : ''}`} style={{ background: STORY_BACKGROUNDS[id] }}
                      onClick={() => setBackground(id)} disabled={uploading} />
                  ))}
                </div>
                <p className={`sc__textstory-text ${caption.trim() ? '' : 'is-empty'} ${caption.length > 140 ? 'is-long' : ''}`}>
                  {caption.trim() ? caption : t('home.story.textHint')}
                </p>
                {mention?.kind && (
                  <span className={`sc__preview-mention is-${mention.kind}`}>
                    {mention.kind === 'praise' ? '👍' : '⚠️'} @{mention.user.username}
                  </span>
                )}
                {selected && (
                  <span className="sc__preview-cta">
                    <FontAwesomeIcon icon={selected.isFolder ? faFolder : faCode} />
                    {selected.title}
                  </span>
                )}
              </div>
            )}
            <input ref={inputRef} type="file" accept={ACCEPT_MEDIA} hidden
              onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          </div>

          {/* Оң жақ — мәтін және жоба */}
          <div className="sc__form">
            <label className="sc__field">
              <span className="sc__label sc__label--end">
                <em>{caption.length}/{CAPTION_MAX}</em>
              </span>
              <textarea ref={captionRef} aria-label={t('home.story.caption')} value={caption} maxLength={CAPTION_MAX} rows={3} disabled={uploading}
                placeholder={t('home.story.captionPlaceholder')} onChange={(e) => setCaption(e.target.value)} />
            </label>

            {/* Жобасы жоқ адам шағым жазса — жоба өрісі керек емес, көрсетпейміз */}
            {!(complaint && projects.length === 0) && (
            <div className="sc__field sc__field--grow">
              <small className="sc__hint">{t('home.story.projectHint')}</small>

              {projects.length === 0 ? (
                /* Жоба жоқ — қалай жасауды үйрететін карта: осы терезеден шықпай жүктеу */
                <div className="sc__onboard">
                  <span className="sc__onboard-icon"><FontAwesomeIcon icon={faCode} /></span>
                  <strong>{t('home.story.noProjectsTitle')}</strong>
                  <ol className="sc__onboard-steps">
                    <li>{t('home.story.onboardStep1')}</li>
                    <li>{t('home.story.onboardStep2')}</li>
                    <li>{t('home.story.onboardStep3')}</li>
                  </ol>
                  <button type="button" className="sc__btn sc__btn--primary" onClick={() => setUploadOpen(true)} disabled={uploading}>
                    <FontAwesomeIcon icon={faPlus} />
                    {t('home.story.createProject')}
                  </button>
                  <Link to="/vibecoding" className="sc__onboard-learn">
                    <FontAwesomeIcon icon={faGraduationCap} />
                    <span>
                      <b>{t('home.story.learnTitle')}</b>
                      {t('home.story.learnText')}
                    </span>
                  </Link>
                </div>
              ) : (
                /* Dropdown: басқанда тек өз жобаларым ашылады */
                <div className="sc__dd" ref={ddRef}>
                  <button type="button" className={`sc__dd-trigger ${ddOpen ? 'is-open' : ''}`} disabled={uploading}
                    aria-haspopup="listbox" aria-expanded={ddOpen} onClick={() => setDdOpen((o) => !o)}>
                    <span className="sc__project-icon">
                      <FontAwesomeIcon icon={selected ? (selected.isFolder ? faFolder : faCode) : faLink} />
                    </span>
                    <span className="sc__project-title">{selected ? selected.title : t('home.story.chooseProject')}</span>
                    {selected?.language && <span className="sc__project-lang">{selected.language}</span>}
                    <FontAwesomeIcon icon={faChevronDown} className="sc__dd-caret" />
                  </button>

                  {ddOpen && (
                    <div className="sc__dd-menu">
                      {projects.length > 5 && (
                        <label className="sc__search">
                          <FontAwesomeIcon icon={faMagnifyingGlass} />
                          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                            placeholder={t('home.story.searchProjects')} />
                        </label>
                      )}
                      <ul className="sc__projects" role="listbox">
                        {filteredProjects.map((p) => (
                          <li key={p.id}>
                            <button type="button" role="option" aria-selected={projectId === p.id}
                              className={`sc__project ${projectId === p.id ? 'is-on' : ''}`} onClick={() => chooseProject(p.id)}>
                              <span className="sc__project-icon"><FontAwesomeIcon icon={p.isFolder ? faFolder : faCode} /></span>
                              <span className="sc__project-title">{p.title}</span>
                              {p.language && <span className="sc__project-lang">{p.language}</span>}
                              {projectId === p.id && <FontAwesomeIcon icon={faCheck} className="sc__check" />}
                            </button>
                          </li>
                        ))}
                        {filteredProjects.length === 0 && <li className="sc__dd-none">{t('home.noCodes')}</li>}
                      </ul>
                      <button type="button" className="sc__dd-new" onClick={() => { setDdOpen(false); setUploadOpen(true); }}>
                        <FontAwesomeIcon icon={faPlus} />
                        {t('home.story.createProject')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            <div ref={mentionRef}>
              <StoryMentionPicker value={mention} onChange={setMention} currentUserId={user?.id} disabled={uploading} />
            </div>
          </div>
        </div>

        <footer className="sc__foot">
          {error && <p className="sc__error" role="alert">{error}</p>}
          {uploading && (
            <span className="sc__progress" aria-label={t('home.story.uploading')}>
              <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </span>
          )}
          {/* Не толтырылды / не қалды */}
          <ul className="sc__steps" aria-label={t('home.story.required')}>
            {steps.map((s) => (
              <li key={s.key} className={s.done ? 'is-done' : ''}>
                <button type="button" className="sc__step" onClick={() => goToStep(s.key)} disabled={s.done}>
                  <span className="sc__step-dot">{s.done && <FontAwesomeIcon icon={faCheck} />}</span>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
          <span className="sc__ttl">{ready ? t('home.story.ttl') : t('home.story.fillAll')}</span>
          <button type="button" className="sc__btn" onClick={close}>{t('home.story.cancel')}</button>
          <button type="button" className="sc__btn sc__btn--primary" onClick={publish} disabled={!ready || uploading}
            title={ready ? undefined : t('home.story.fillAll')}>
            <FontAwesomeIcon icon={faPaperPlane} />
            {uploading ? `${Math.round((progress ?? 0) * 100)}%` : t('home.story.publish')}
          </button>
        </footer>
      </div>

      {/* Жоба жүктеу — сторис терезесінің үстінде ашылады, жазылғандар сақталады */}
      {uploadOpen && (
        <div className="sc__upload-layer" onClick={(e) => e.stopPropagation()}>
          <UploadModal isOpen onClose={() => setUploadOpen(false)} onSuccess={onProjectUploaded} />
        </div>
      )}
    </div>,
    document.body
  );
};

export default StoryComposer;
