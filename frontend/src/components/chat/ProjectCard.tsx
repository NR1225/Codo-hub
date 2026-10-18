import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { apiService, Message, ProjectCardMeta } from '../../utils/api';
import { CodeBracketsIcon, SparkleIcon } from '../home/icons';
import { FileIcon, FolderIcon } from './MediaIcons';

/* Чаттағы жоба картасы (type='project'): репозиторий немесе Vibecoding жобасы.
   Деректерді сервер толтырады — клиент тек көрсетеді. */

interface ProjectCardProps {
  message: Message;
  currentUserId?: string;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ message, currentUserId }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const [forking, setForking] = useState(false);
  const meta = (message.metadata || {}) as Partial<ProjectCardMeta>;
  const isRepo = meta.kind === 'repo';
  const isMine = message.fromUserId === currentUserId;

  if (!meta.projectId || !meta.kind) {
    return <span className="chat-message-text-content">{message.content}</span>;
  }

  const fork = async () => {
    setForking(true);
    try {
      const copy = await apiService.forkSharedProject(
        message.id,
        message.groupId,
        `${meta.title} (${t('chat.project.copySuffix')})`
      );
      navigate(`/vibecoding?project=${encodeURIComponent(copy.id)}`);
    } catch (err) {
      const text = err instanceof Error ? err.message : '';
      toast.error(/табылмады|not found/i.test(text) ? t('chat.project.notFound') : text || t('chat.project.forkError'));
      setForking(false);
    }
  };

  return (
    <div className="chat-message-content">
      <div className={`cht-pcard ${meta.invite ? 'is-invite' : ''}`}>
        {meta.invite && (
          <div className="cht-pcard__banner">
            <SparkleIcon size={14} />
            {t('chat.project.inviteBanner')}
          </div>
        )}

        <div className="cht-pcard__head">
          <span className="cht-pcard__icon" aria-hidden="true">
            {isRepo ? <FolderIcon size={20} /> : <CodeBracketsIcon />}
          </span>
          <div className="cht-pcard__titles">
            <span className="cht-pcard__kind">{isRepo ? t('chat.project.repoLabel') : t('chat.project.vibeLabel')}</span>
            <span className="cht-pcard__title">{meta.title}</span>
          </div>
        </div>

        {meta.description && <p className="cht-pcard__desc">{meta.description}</p>}

        <div className="cht-pcard__meta">
          {meta.language && <span className="cht-pcard__chip">{meta.language}</span>}
          {typeof meta.fileCount === 'number' && (
            <span className="cht-pcard__stat">
              <FileIcon size={13} />
              {t('chat.project.files', { count: meta.fileCount })}
            </span>
          )}
          {meta.author && <span className="cht-pcard__stat">@{meta.author}</span>}
        </div>

        <div className="cht-pcard__actions">
          {isRepo ? (
            <>
              <button type="button" className="cht-pcard__btn is-primary" onClick={() => navigate(`/view/${meta.projectId}`)}>
                {t('chat.project.open')}
              </button>
              <button
                type="button"
                className="cht-pcard__btn"
                onClick={() => navigate(`/vibecoding?repo=${encodeURIComponent(meta.projectId!)}`)}
              >
                {t('chat.project.openInVibecoding')}
              </button>
            </>
          ) : isMine ? (
            <button
              type="button"
              className="cht-pcard__btn is-primary"
              onClick={() => navigate(`/vibecoding?project=${encodeURIComponent(meta.projectId!)}`)}
            >
              {t('chat.project.openInVibecoding')}
            </button>
          ) : (
            <button type="button" className="cht-pcard__btn is-primary" onClick={fork} disabled={forking}>
              {forking ? t('chat.project.forking') : t('chat.project.fork')}
            </button>
          )}
        </div>
      </div>
      {message.content && <div className="chat-message-text">{message.content}</div>}
    </div>
  );
};

export default ProjectCard;
