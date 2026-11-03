import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFloppyDisk, faTrash, faUserMinus } from '@fortawesome/free-solid-svg-icons';
import { useConfirm } from '../../contexts/ToastContext';
import { adminApi, AdminGroup, errText, fmtDate } from './adminApi';
import { Drawer, ListState, PAGE_SIZE, Pager, PersonTag, SearchBox, useAdminToast, usePaged } from './AdminShared';

const AdminGroups: React.FC<{ itemId?: string }> = ({ itemId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = usePaged((offset) => adminApi.groups({ q, offset, limit: PAGE_SIZE }), [q]);

  return (
    <section className="mon__card">
      <div className="adm__toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('admin.groups.search')} />
      </div>
      <ListState loading={list.loading} error={list.error} empty={list.items.length === 0} />
      {list.items.length > 0 && (
        <div className="mon__scroll">
          <table className="mon__table adm__rows">
            <thead>
              <tr>
                <th>{t('admin.groups.name')}</th>
                <th>{t('admin.groups.owner')}</th>
                <th className="mon__num">{t('admin.groups.members')}</th>
                <th className="mon__num">{t('admin.groups.messages')}</th>
                <th>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((g) => (
                <tr key={g.id} onClick={() => navigate(`/admin/groups/${encodeURIComponent(g.id)}`)}>
                  <td><b>{g.name}</b>{g.description && <div className="adm__muted">{g.description}</div>}</td>
                  <td>{g.owner ? `@${g.owner.username}` : '—'}</td>
                  <td className="mon__num">{g.members}</td>
                  <td className="mon__num">{g.messages}</td>
                  <td className="mon__nowrap">{fmtDate(g.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={list.total} offset={list.offset} go={list.go} />
      {itemId && <GroupDrawer groupId={itemId} onClose={() => navigate('/admin/groups')} onChanged={list.reload} />}
    </section>
  );
};

const GroupDrawer: React.FC<{ groupId: string; onClose: () => void; onChanged: () => void }> = ({ groupId, onClose, onChanged }) => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [group, setGroup] = useState<AdminGroup | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  const load = useCallback(() => {
    adminApi.group(groupId).then((g) => {
      setGroup(g);
      setForm({ name: g.name, description: g.description || '' });
    }).catch((e) => toast.error(errText(e)));
  }, [groupId, toast]);
  useEffect(() => { setGroup(null); load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, after: () => void, confirmTitle?: string) => {
    if (confirmTitle && !(await confirm({ title: confirmTitle, danger: true }))) return;
    try {
      await fn();
      toast.success(t('admin.saved'));
      after();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Drawer wide onClose={onClose} title={group ? group.name : t('common.loading', { defaultValue: '…' })}>
      {group && (
        <div className="adm__stack">
          <form className="adm__form" onSubmit={(e) => { e.preventDefault(); act(() => adminApi.updateGroup(group.id, form), () => { load(); onChanged(); }); }}>
            <label>{t('admin.groups.name')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} /></label>
            <label>{t('admin.projects.description')}<textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} /></label>
            <div className="adm__row">
              <button type="submit" className="mon__btn adm__primary"><FontAwesomeIcon icon={faFloppyDisk} /> {t('admin.save')}</button>
              <button type="button" className="mon__btn adm__danger"
                onClick={() => act(() => adminApi.deleteGroup(group.id), () => { onChanged(); onClose(); }, t('admin.groups.deleteConfirm', { name: group.name }))}>
                <FontAwesomeIcon icon={faTrash} /> {t('admin.groups.delete')}
              </button>
            </div>
          </form>

          <div className="adm__panel">
            <h3>{t('admin.groups.members')} ({group.members.length})</h3>
            <ul className="adm__list">
              {group.members.map((m) => (
                <li key={m.id} className="adm__list-row">
                  <PersonTag p={m} />
                  <span className="adm__badge">{m.role}</span>
                  <span className="adm__muted">{fmtDate(m.joinedAt)}</span>
                  {m.role !== 'owner' && (
                    <button type="button" className="mon__icon-btn" title={t('admin.groups.removeMember')}
                      onClick={() => act(() => adminApi.removeMember(group.id, m.id), load, t('admin.groups.removeConfirm', { name: m.username }))}>
                      <FontAwesomeIcon icon={faUserMinus} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="adm__panel">
            <h3>{t('admin.groups.messages')} ({group.messages.length})</h3>
            <p className="adm__notice">{t('admin.privacyNote')}</p>
            <div className="adm__chat">
              {group.messages.length === 0 && <p className="mon__empty">{t('monitoring.none')}</p>}
              {group.messages.map((m) => (
                <div key={m.id} className={`adm__msg${m.type === 'system' ? ' is-system' : ''}`}>
                  <div className="adm__msg-meta">
                    <b>{m.sender ? `@${m.sender.username}` : m.fromUserId}</b>
                    <span>{fmtDate(m.createdAt)}</span>
                  </div>
                  <div className="adm__msg-body">{m.content || <i className="adm__muted">[{m.type}]</i>}</div>
                  {m.type !== 'system' && (
                    <div className="adm__msg-actions">
                      <button type="button" className="mon__icon-btn" title={t('admin.delete')}
                        onClick={() => act(() => adminApi.deleteGroupMessage(group.id, m.id),
                          () => setGroup((g) => g && { ...g, messages: g.messages.filter((x) => x.id !== m.id) }), t('admin.messages.deleteConfirm'))}>
                        <FontAwesomeIcon icon={faTrash} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default AdminGroups;
