import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import { apiService, CodeFile, VibecodingProjectDTO } from '../../utils/api';
import { CheckSmallIcon, CloseIcon, CodeBracketsIcon, SparkleIcon } from '../home/icons';
import { FolderIcon } from './MediaIcons';

/* Чатқа жоба бөлісу: өз репозиторийім, Vibecoding жобам немесе «Бірге бастау» (жаңа жоба + шақыру) */

export interface ProjectShare {
  kind: 'repo' | 'vibe';
  projectId: string;
  invite?: boolean;
}

interface ShareProjectModalProps {
  username: string;
  onClose: () => void;
  onShare: (share: ProjectShare, comment: string) => Promise<void>;
}

type Tab = 'repo' | 'vibe' | 'new';

const ShareProjectModal: React.FC<ShareProjectModalProps> = ({ username, onClose, onShare }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('repo');
  const [repos, setRepos] = useState<CodeFile[] | null>(null);
  const [vibes, setVibes] = useState<VibecodingProjectDTO[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newGoal, setNewGoal] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiService
      .getAllCodesBy(username)
      .then(setRepos)
      .catch(() => setRepos([]));
    apiService
      .getVibecodingProjects()
      .then(setVibes)
      .catch(() => setVibes([]));
  }, [username]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !sending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelected(null);
    setError(null);
  };

  const canSend = tab === 'new' ? newName.trim().length > 0 : !!selected;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || sending) return;
    setSending(true);
    setError(null);
    try {
      if (tab === 'new') {
        // Жаңа Vibecoding жобасы — README-мен басталады, содан кейін шақыру картасы жіберіледі
        const id = `team-${uuidv4()}`;
        const name = newName.trim();
        const readme = `# ${name}\n\n${newGoal.trim() ? `${newGoal.trim()}\n\n` : ''}${t('chat.project.readmeNote')}\n`;
        await apiService.saveVibecodingProject(id, {
          name,
          files: [{ id: uuidv4(), name: 'README.md', path: 'README.md', content: readme, language: 'markdown' }],
          folders: [],
          createdAt: new Date().toISOString(),
        });
        await onShare({ kind: 'vibe', projectId: id, invite: true }, comment.trim());
      } else {
        await onShare({ kind: tab, projectId: selected! }, comment.trim());
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.project.shareError'));
      setSending(false);
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'repo', label: t('chat.project.repos'), icon: <FolderIcon size={15} /> },
    { key: 'vibe', label: t('chat.project.vibe'), icon: <CodeBracketsIcon /> },
    { key: 'new', label: t('chat.project.together'), icon: <SparkleIcon size={15} /> },
  ];

  const renderList = (items: { id: string; title: string; sub: string }[] | null, empty: string) =>
    items === null ? (
      Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="cht-skel">
          <span />
          <span />
        </div>
      ))
    ) : items.length === 0 ? (
      <p className="cht-empty">{empty}</p>
    ) : (
      items.map((item) => {
        const isOn = selected === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={isOn}
            className={`cht-item cht-picker__row ${isOn ? 'is-active' : ''}`}
            onClick={() => setSelected(item.id)}
          >
            <span className="cht-pcard__icon cht-pcard__icon--sm" aria-hidden="true">
              {tab === 'repo' ? <FolderIcon size={16} /> : <CodeBracketsIcon />}
            </span>
            <span className="cht-item__body">
              <span className="cht-item__name">{item.title}</span>
              <span className="cht-item__last">{item.sub}</span>
            </span>
            <span className={`cht-picker__check ${isOn ? 'is-on' : ''}`} aria-hidden="true">
              {isOn && <CheckSmallIcon size={14} />}
            </span>
          </button>
        );
      })
    );

  return (
    <div className="cht-overlay" onClick={() => !sending && onClose()}>
      <form
        className="cht-modal cht-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.project.share')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="cht-modal__head">
          <h2>{t('chat.project.share')}</h2>
          <button type="button" className="cht-icon-btn x-close" onClick={onClose} aria-label={t('common.close')}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="cht-modal__body">
          <div className="cht-tabs" role="tablist">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                type="button"
                role="tab"
                aria-selected={tab === tb.key}
                className={`cht-tab ${tab === tb.key ? 'is-active' : ''}`}
                onClick={() => switchTab(tb.key)}
              >
                {tb.icon}
                <span>{tb.label}</span>
              </button>
            ))}
          </div>

          {tab === 'new' ? (
            <div className="cht-together">
              <span className="cht-together__icon" aria-hidden="true">
                <SparkleIcon size={22} />
              </span>
              <p className="cht-together__text">{t('chat.project.togetherHint')}</p>
              <input
                className="cht-field"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('chat.project.newNamePlaceholder')}
                aria-label={t('chat.project.newName')}
                maxLength={200}
                autoFocus
              />
              <input
                className="cht-field cht-field--sm"
                value={newGoal}
                onChange={(e) => setNewGoal(e.target.value)}
                placeholder={t('chat.project.newGoalPlaceholder')}
                aria-label={t('chat.project.newGoal')}
                maxLength={300}
              />
            </div>
          ) : (
            <div className="cht-picker__list cht-share__list" role="radiogroup">
              {tab === 'repo'
                ? renderList(
                    repos?.map((r) => ({
                      id: r.id,
                      title: r.title,
                      sub: [r.language, r.isFolder ? t('chat.project.folder') : null].filter(Boolean).join(' · '),
                    })) ?? null,
                    t('chat.project.noRepos')
                  )
                : renderList(
                    vibes?.map((v) => ({ id: v.id, title: v.name, sub: t('chat.project.files', { count: v.files.length }) })) ?? null,
                    t('chat.project.noVibe')
                  )}
            </div>
          )}

          <input
            className="cht-field cht-field--sm cht-share__comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('chat.project.comment')}
            aria-label={t('chat.project.comment')}
            maxLength={1000}
          />

          {error && (
            <p className="cht-form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="cht-modal__foot">
          <button type="button" className="cht-btn cht-btn--ghost" onClick={onClose} disabled={sending}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="cht-btn cht-btn--primary" disabled={!canSend || sending}>
            {tab === 'new' ? <SparkleIcon size={16} /> : <FolderIcon size={16} />}
            {sending ? t('chat.project.sending') : tab === 'new' ? t('chat.project.startTogether') : t('chat.project.send')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ShareProjectModal;
