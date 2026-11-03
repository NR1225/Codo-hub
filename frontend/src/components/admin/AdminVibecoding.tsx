import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFloppyDisk, faLinkSlash, faTrash } from '@fortawesome/free-solid-svg-icons';
import { useConfirm } from '../../contexts/ToastContext';
import { adminApi, AdminVibe, errText, fmtDate } from './adminApi';
import { Drawer, ListState, PAGE_SIZE, Pager, PersonTag, SearchBox, useAdminToast, usePaged } from './AdminShared';

const AdminVibecoding: React.FC<{ itemId?: string }> = ({ itemId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const list = usePaged((offset) => adminApi.vibecoding({ q, offset, limit: PAGE_SIZE }), [q]);

  return (
    <section className="mon__card">
      <div className="adm__toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('admin.vibe.search')} />
      </div>
      <ListState loading={list.loading} error={list.error} empty={list.items.length === 0} />
      {list.items.length > 0 && (
        <div className="mon__scroll">
          <table className="mon__table adm__rows">
            <thead>
              <tr>
                <th>{t('admin.groups.name')}</th>
                <th>{t('admin.groups.owner')}</th>
                <th className="mon__num">{t('admin.projects.files')}</th>
                <th>{t('admin.vibe.shared')}</th>
                <th>{t('admin.updated')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((p) => (
                <tr key={p.id} onClick={() => navigate(`/admin/vibecoding/${encodeURIComponent(p.id)}`)}>
                  <td><b>{p.name}</b></td>
                  <td>{p.owner ? `@${p.owner.username}` : '—'}</td>
                  <td className="mon__num">{p.files}</td>
                  <td>{p.shared ? '✓' : '—'}</td>
                  <td className="mon__nowrap">{fmtDate(p.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={list.total} offset={list.offset} go={list.go} />
      {itemId && <VibeDrawer projectId={itemId} onClose={() => navigate('/admin/vibecoding')} onChanged={list.reload} />}
    </section>
  );
};

const VibeDrawer: React.FC<{ projectId: string; onClose: () => void; onChanged: () => void }> = ({ projectId, onClose, onChanged }) => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [project, setProject] = useState<AdminVibe | null>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState(0);

  const load = useCallback(() => {
    adminApi.vibe(projectId).then((p) => { setProject(p); setName(p.name); }).catch((e) => toast.error(errText(e)));
  }, [projectId, toast]);
  useEffect(() => { setProject(null); setFile(0); load(); }, [load]);

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

  const current = project?.files[file];

  return (
    <Drawer wide onClose={onClose} title={project ? project.name : t('common.loading', { defaultValue: '…' })}>
      {project && (
        <div className="adm__stack">
          <div className="adm__facts">
            <div><span>{t('admin.groups.owner')}</span><b><PersonTag p={{ id: project.ownerId, username: project.ownerId }} /></b></div>
            <div><span>{t('admin.created')}</span><b>{fmtDate(project.createdAt)}</b></div>
            <div><span>{t('admin.updated')}</span><b>{fmtDate(project.updatedAt)}</b></div>
          </div>
          <form className="adm__row" onSubmit={(e) => { e.preventDefault(); act(() => adminApi.updateVibe(project.id, { name }), () => { load(); onChanged(); }); }}>
            <input className="adm__input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
            <button type="submit" className="mon__btn adm__primary" disabled={!name.trim() || name === project.name}>
              <FontAwesomeIcon icon={faFloppyDisk} /> {t('admin.save')}
            </button>
          </form>
          <div className="adm__row">
            {project.shared && (
              <button type="button" className="mon__btn" onClick={() => act(() => adminApi.updateVibe(project.id, { revokeShare: true }), () => { load(); onChanged(); })}>
                <FontAwesomeIcon icon={faLinkSlash} /> {t('admin.vibe.revokeShare')}
              </button>
            )}
            <button type="button" className="mon__btn adm__danger"
              onClick={() => act(() => adminApi.deleteVibe(project.id), () => { onChanged(); onClose(); }, t('admin.projects.deleteConfirm', { title: project.name }))}>
              <FontAwesomeIcon icon={faTrash} /> {t('admin.delete')}
            </button>
          </div>

          <div className="adm__panel">
            <h3>{t('admin.projects.files')} ({project.files.length})</h3>
            {project.files.length === 0 ? <p className="mon__empty">{t('monitoring.none')}</p> : (
              <div className="adm__files">
                <ul className="adm__file-list">
                  {project.files.map((f, i) => (
                    <li key={f.path + i}>
                      <button type="button" className={i === file ? 'is-active' : ''} onClick={() => setFile(i)}>{f.path}</button>
                    </li>
                  ))}
                </ul>
                <pre className="adm__code adm__pre">{current?.content || ''}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default AdminVibecoding;
