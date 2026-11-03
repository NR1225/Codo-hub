import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faFloppyDisk, faFolder, faLock, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useConfirm } from '../../contexts/ToastContext';
import { adminApi, AdminCode, AdminCodeRow, AdminComment, errText, fmtDate } from './adminApi';
import { Drawer, ListState, PAGE_SIZE, Pager, SearchBox, useAdminToast, usePaged } from './AdminShared';

const AdminProjects: React.FC<{ itemId?: string }> = ({ itemId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const author = params.get('author') || '';
  const [q, setQ] = useState('');
  const list = usePaged((offset) => adminApi.codes({ q, author, offset, limit: PAGE_SIZE }), [q, author]);
  const open = (id: string) => navigate({ pathname: `/admin/projects/${encodeURIComponent(id)}`, search: params.toString() });

  return (
    <section className="mon__card">
      <div className="adm__toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('admin.projects.search')} />
        {author && (
          <button type="button" className="adm__chip is-active" onClick={() => setParams({})}>
            @{author} <FontAwesomeIcon icon={faXmark} />
          </button>
        )}
      </div>
      <ListState loading={list.loading} error={list.error} empty={list.items.length === 0} />
      {list.items.length > 0 && <CodeTable rows={list.items} onOpen={open} />}
      <Pager total={list.total} offset={list.offset} go={list.go} />
      {itemId && (
        <ProjectDrawer codeId={itemId} onOpen={open} onChanged={list.reload}
          onClose={() => navigate({ pathname: '/admin/projects', search: params.toString() })} />
      )}
    </section>
  );
};

const CodeTable: React.FC<{ rows: AdminCodeRow[]; onOpen: (id: string) => void }> = ({ rows, onOpen }) => {
  const { t } = useTranslation();
  return (
    <div className="mon__scroll">
      <table className="mon__table adm__rows">
        <thead>
          <tr>
            <th>{t('admin.projects.title')}</th>
            <th>{t('admin.projects.author')}</th>
            <th className="mon__num">♥</th>
            <th className="mon__num">💬</th>
            <th className="mon__num">👁</th>
            <th>{t('admin.created')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c.id)}>
              <td>
                {c.isFolder && <FontAwesomeIcon icon={faFolder} className="adm__muted" />}{' '}
                <b>{c.folderPath || c.title}</b>
                {c.isPrivate && <> <FontAwesomeIcon icon={faLock} className="adm__muted" title={t('admin.projects.private')} /></>}
                {c.files !== null && <span className="adm__muted"> · {t('admin.vibe.filesCount', { count: c.files })}</span>}
              </td>
              <td>@{c.author}</td>
              <td className="mon__num">{c.likes}</td>
              <td className="mon__num">{c.comments}</td>
              <td className="mon__num">{c.views}</td>
              <td className="mon__nowrap">{fmtDate(c.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ProjectDrawer: React.FC<{ codeId: string; onClose: () => void; onChanged: () => void; onOpen: (id: string) => void }> = ({
  codeId, onClose, onChanged, onOpen,
}) => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [code, setCode] = useState<AdminCode | null>(null);
  const [files, setFiles] = useState<AdminCodeRow[]>([]);
  const [form, setForm] = useState({ title: '', description: '', tags: '', isPrivate: false, content: '' });
  const [busy, setBusy] = useState(false);

  const fill = (c: AdminCode) => {
    setCode(c);
    setForm({
      title: c.title || '', description: c.description || '', tags: (c.tags || []).join(', '),
      isPrivate: !!c.isPrivate, content: c.content || '',
    });
  };

  const load = useCallback(() => {
    adminApi.code(codeId).then(fill).catch((e) => toast.error(errText(e)));
  }, [codeId, toast]);

  useEffect(() => { setCode(null); load(); }, [load]);
  useEffect(() => {
    if (code?.isFolder) adminApi.codes({ folderId: code.id, limit: 200 }).then((r) => setFiles(r.items)).catch(() => setFiles([]));
    else setFiles([]);
  }, [code?.id, code?.isFolder]);

  const save = async () => {
    if (!code) return;
    const tags = form.tags.split(',').map((s) => s.trim()).filter(Boolean);
    const body: Parameters<typeof adminApi.updateCode>[1] = {};
    if (form.title !== code.title) body.title = form.title;
    if (form.description !== (code.description || '')) body.description = form.description;
    if (tags.join(',') !== (code.tags || []).join(',')) body.tags = tags;
    if (!code.folderId && form.isPrivate !== !!code.isPrivate) body.isPrivate = form.isPrivate;
    if (!code.isFolder && form.content !== (code.content || '')) body.content = form.content;
    if (!Object.keys(body).length) return;
    setBusy(true);
    try {
      await adminApi.updateCode(code.id, body);
      toast.success(t('admin.saved'));
      load();
      onChanged();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!code) return;
    const ok = await confirm({ title: t('admin.projects.deleteConfirm', { title: code.title }), message: code.isFolder ? t('admin.projects.deleteFolderHint') : undefined, danger: true });
    if (!ok) return;
    try {
      await adminApi.deleteCode(code.id);
      toast.success(t('admin.deleted'));
      onChanged();
      onClose();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const removeComment = async (c: AdminComment) => {
    if (!code || !(await confirm({ title: t('admin.projects.deleteComment'), message: c.content.slice(0, 200), danger: true }))) return;
    try {
      await adminApi.deleteComment(code.id, c.id);
      load();
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <Drawer wide onClose={onClose} title={code ? (code.folderPath || code.title) : t('common.loading', { defaultValue: '…' })}>
      {code && (
        <div className="adm__stack">
          <div className="adm__facts">
            <div><span>{t('admin.projects.author')}</span><b><Link to={`/admin/projects?author=${encodeURIComponent(code.author)}`}>@{code.author}</Link></b></div>
            <div><span>{t('admin.created')}</span><b>{fmtDate(code.createdAt)}</b></div>
            <div><span>{t('admin.updated')}</span><b>{fmtDate(code.updatedAt)}</b></div>
            <div><span>♥</span><b>{code.likes?.length ?? 0}</b></div>
            {code.protection && <div><span>{t('admin.projects.protection')}</span><b>{code.protection}</b></div>}
            <div>
              <span>{t('admin.projects.page')}</span>
              <b><Link to={`/view/${encodeURIComponent(code.id)}`} target="_blank" rel="noopener noreferrer">
                {t('admin.open')} <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
              </Link></b>
            </div>
          </div>
          {code.folderId && (
            <button type="button" className="mon__btn adm__back" onClick={() => onOpen(code.folderId!)}>
              <FontAwesomeIcon icon={faFolder} /> {t('admin.projects.parent')}
            </button>
          )}

          <form className="adm__form" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <label>{t('admin.projects.title')}<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} /></label>
            <label>{t('admin.projects.description')}<textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label>{t('admin.projects.tags')}<input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
            {!code.folderId && (
              <label className="adm__check">
                <input type="checkbox" checked={form.isPrivate} onChange={(e) => setForm({ ...form, isPrivate: e.target.checked })} />
                {t('admin.projects.private')}
              </label>
            )}
            {!code.isFolder && (
              <label>{t('admin.projects.content')}
                <textarea className="adm__code" rows={16} value={form.content} spellCheck={false}
                  onChange={(e) => setForm({ ...form, content: e.target.value })} disabled={code.protection === 'database'} />
              </label>
            )}
            <div className="adm__row">
              <button type="submit" className="mon__btn adm__primary" disabled={busy}><FontAwesomeIcon icon={faFloppyDisk} /> {t('admin.save')}</button>
              <button type="button" className="mon__btn adm__danger" onClick={remove}><FontAwesomeIcon icon={faTrash} /> {t('admin.delete')}</button>
            </div>
          </form>

          {code.isFolder && (
            <div className="adm__panel">
              <h3>{t('admin.projects.files')} ({files.length})</h3>
              {files.length ? <CodeTable rows={files} onOpen={onOpen} /> : <p className="mon__empty">{t('monitoring.none')}</p>}
            </div>
          )}

          <div className="adm__panel">
            <h3>{t('admin.projects.comments')} ({code.comments?.length ?? 0})</h3>
            {!code.comments?.length && <p className="mon__empty">{t('monitoring.none')}</p>}
            {code.comments?.map((c) => (
              <div key={c.id} className="adm__comment">
                <div className="adm__msg-meta"><b>@{c.author}</b><span>{fmtDate(c.createdAt)}</span></div>
                <p>{c.content}</p>
                <button type="button" className="mon__icon-btn" title={t('admin.delete')} onClick={() => removeComment(c)}>
                  <FontAwesomeIcon icon={faTrash} />
                </button>
                {c.replies?.map((r) => (
                  <div key={r.id} className="adm__reply">
                    <div className="adm__msg-meta"><b>@{r.author}</b><span>{fmtDate(r.createdAt)}</span></div>
                    <p>{r.content}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
};

export default AdminProjects;
