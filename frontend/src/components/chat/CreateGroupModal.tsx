import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiService, ChatGroupDetails, GroupUser } from '../../utils/api';
import { CloseIcon, UsersIcon } from '../home/icons';
import { monogram } from '../home/monogram';
import UserPicker from './UserPicker';

interface CreateGroupModalProps {
  currentUserId: string;
  suggestions: GroupUser[];
  onClose: () => void;
  onCreated: (group: ChatGroupDetails) => void;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ currentUserId, suggestions, onClose, onCreated }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<GroupUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('chat.group.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const group = await apiService.createGroup(name.trim(), members.map((m) => m.id), description.trim() || undefined);
      onCreated(group);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.group.createError'));
      setSaving(false);
    }
  };

  return (
    <div className="cht-overlay" onClick={() => !saving && onClose()}>
      <form
        className="cht-modal cht-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label={t('chat.group.createGroup')}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="cht-modal__head">
          <h2>{t('chat.group.createGroup')}</h2>
          <button type="button" className="cht-icon-btn" onClick={onClose} aria-label={t('common.close')}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="cht-modal__body">
          <div className="cht-newgroup">
            {/* Атау жазылған сайын белгіше өзгереді */}
            <span className="cht-gavatar cht-gavatar--lg" aria-hidden="true">
              {name.trim() ? monogram(name) : <UsersIcon size={24} />}
            </span>
            <div className="cht-newgroup__fields">
              <input
                className="cht-field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('chat.group.groupNamePlaceholder')}
                aria-label={t('chat.group.groupName')}
                maxLength={100}
                autoFocus
              />
              <input
                className="cht-field cht-field--sm"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('chat.group.descriptionPlaceholder')}
                aria-label={t('chat.group.description')}
                maxLength={500}
              />
            </div>
          </div>

          <h4 className="cht-section">
            {t('chat.group.addMembers')}
            {members.length > 0 && <span className="cht-section__count">{members.length}</span>}
          </h4>
          <UserPicker selected={members} onChange={setMembers} excludeIds={[currentUserId]} suggestions={suggestions} />

          {error && (
            <p className="cht-form-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="cht-modal__foot">
          <button type="button" className="cht-btn cht-btn--ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="cht-btn cht-btn--primary" disabled={saving || !name.trim()}>
            <UsersIcon size={16} />
            {saving ? t('chat.group.creating') : t('chat.group.create')}
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateGroupModal;
