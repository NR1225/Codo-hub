import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBan, faLockOpen, faRightFromBracket, faTrash, faPen, faFloppyDisk, faArrowLeft, faUserShield, faShieldHalved,
} from '@fortawesome/free-solid-svg-icons';
import { useConfirm } from '../../contexts/ToastContext';
import {
  adminApi, AdminUser, ChatMsg, Conversation, errText, fmtDate, NoteFull, NoteMeta, Person, AdminVibeRow,
} from './adminApi';
import { Drawer, ListState, PAGE_SIZE, Pager, SearchBox, useAdminToast, usePaged } from './AdminShared';

const FILTERS = ['', 'banned', 'moderators', 'admins'] as const;

const Badges: React.FC<{ u: AdminUser }> = ({ u }) => {
  const { t } = useTranslation();
  return (
    <span className="adm__badges">
      {u.isAdmin && <span className="adm__badge adm__badge--admin">{t('admin.users.admin')}</span>}
      {u.role === 'moderator' && <span className="adm__badge">{t('admin.users.moderator')}</span>}
      {u.banned && <span className="adm__badge adm__badge--bad">{t('admin.users.banned')}</span>}
      {u.locked && <span className="adm__badge adm__badge--warn">{t('admin.users.locked')}</span>}
    </span>
  );
};

const AdminUsers: React.FC<{ itemId?: string }> = ({ itemId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<string>('');
  const list = usePaged((offset) => adminApi.users({ q, filter, offset, limit: PAGE_SIZE }), [q, filter]);

  return (
    <section className="mon__card">
      <div className="adm__toolbar">
        <SearchBox value={q} onChange={setQ} placeholder={t('admin.users.search')} />
        <div className="adm__chips">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`adm__chip${filter === f ? ' is-active' : ''}`} onClick={() => setFilter(f)}>
              {t(`admin.users.filter.${f || 'all'}`)}
            </button>
          ))}
        </div>
      </div>
      <ListState loading={list.loading} error={list.error} empty={list.items.length === 0} />
      {list.items.length > 0 && (
        <div className="mon__scroll">
          <table className="mon__table adm__rows">
            <thead>
              <tr>
                <th>{t('admin.users.user')}</th>
                <th>Email</th>
                <th>ID</th>
                <th>{t('admin.users.lastSeen')}</th>
                <th>{t('admin.created')}</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((u) => (
                <tr key={u.id} onClick={() => navigate(`/admin/users/${encodeURIComponent(u.id)}`)} className={u.banned ? 'is-banned' : ''}>
                  <td><b>@{u.username}</b> <Badges u={u} /></td>
                  <td className="adm__muted">{u.email}</td>
                  <td className="mon__mono">{u.id}</td>
                  <td className="mon__nowrap">{fmtDate(u.lastSeenAt)}</td>
                  <td className="mon__nowrap">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager total={list.total} offset={list.offset} go={list.go} />
      {itemId && <UserDrawer userId={itemId} onClose={() => navigate('/admin/users')} onChanged={list.reload} />}
    </section>
  );
};

/* ---------- Бір қолданушы ---------- */

type UserTab = 'profile' | 'messages' | 'notes' | 'vibecoding';

const UserDrawer: React.FC<{ userId: string; onClose: () => void; onChanged: () => void }> = ({ userId, onClose, onChanged }) => {
  const { t } = useTranslation();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<UserTab>('profile');

  const load = useCallback(() => {
    adminApi.user(userId).then((u) => { setUser(u); setError(null); }).catch((e) => setError(errText(e)));
  }, [userId]);
  useEffect(() => { setTab('profile'); load(); }, [load]);

  const changed = (u?: AdminUser) => { if (u) setUser((prev) => ({ ...prev, ...u })); load(); onChanged(); };

  return (
    <Drawer wide title={user ? <>@{user.username} <Badges u={user} /></> : t('common.loading', { defaultValue: '…' })} onClose={onClose}>
      {error && <div className="mon__error">{error}</div>}
      {user && (
        <>
          <nav className="adm__tabs adm__tabs--sub">
            {(['profile', 'messages', 'notes', 'vibecoding'] as UserTab[]).map((k) => (
              <button key={k} type="button" className={`adm__tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>
                {t(`admin.users.tabs.${k}`)}
                {user.counts && k !== 'profile' && (
                  <span className="adm__count">{k === 'messages' ? user.counts.conversations : user.counts[k]}</span>
                )}
              </button>
            ))}
          </nav>
          {tab === 'profile' && <UserProfile user={user} onChanged={changed} onDeleted={() => { onChanged(); onClose(); }} />}
          {tab === 'messages' && <UserMessages user={user} />}
          {tab === 'notes' && <UserNotes user={user} />}
          {tab === 'vibecoding' && <UserVibecoding user={user} />}
        </>
      )}
    </Drawer>
  );
};

const UserProfile: React.FC<{ user: AdminUser; onChanged: (u?: AdminUser) => void; onDeleted: () => void }> = ({ user, onChanged, onDeleted }) => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ username: user.username, email: user.email, bio: user.bio || '' });
  const [banReason, setBanReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm({ username: user.username, email: user.email, bio: user.bio || '' }), [user.username, user.email, user.bio]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(ok);
      onChanged(res && typeof res === 'object' && 'id' in res ? (res as AdminUser) : undefined);
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const dirty = form.username !== user.username || form.email !== user.email || form.bio !== (user.bio || '');

  return (
    <div className="adm__stack">
      <div className="adm__facts">
        <div><span>ID</span><b className="mon__mono">{user.id}</b></div>
        <div><span>{t('admin.created')}</span><b>{fmtDate(user.createdAt)}</b></div>
        <div><span>{t('admin.users.lastSeen')}</span><b>{fmtDate(user.lastSeenAt)}</b></div>
        <div><span>2FA</span><b>{user.totpEnabled ? '✓' : '—'}</b></div>
        <div><span>GitHub</span><b>{user.githubLogin || '—'}</b></div>
        {user.counts && (
          <div>
            <span>{t('admin.nav.projects')}</span>
            <b><Link to={`/admin/projects?author=${encodeURIComponent(user.username)}`}>{user.counts.projects}</Link></b>
          </div>
        )}
        {user.counts && <div><span>{t('admin.nav.stories')}</span><b>{user.counts.stories}</b></div>}
        {user.counts && <div><span>{t('admin.nav.groups')}</span><b>{user.counts.groups}</b></div>}
      </div>

      <form className="adm__form" onSubmit={(e) => { e.preventDefault(); run(() => adminApi.updateUser(user.id, form), t('admin.saved')); }}>
        <label>Username<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} maxLength={50} /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Bio<textarea rows={3} value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} maxLength={500} /></label>
        <div className="adm__row">
          <button type="submit" className="mon__btn adm__primary" disabled={!dirty || busy}>
            <FontAwesomeIcon icon={faFloppyDisk} /> {t('admin.save')}
          </button>
          {user.avatar && (
            <button type="button" className="mon__btn" disabled={busy}
              onClick={() => run(() => adminApi.updateUser(user.id, { removeAvatar: true }), t('admin.saved'))}>
              {t('admin.users.removeAvatar')}
            </button>
          )}
        </div>
      </form>

      <div className="adm__panel">
        <h3><FontAwesomeIcon icon={faShieldHalved} /> {t('admin.users.access')}</h3>
        <div className="adm__row">
          {!user.isAdmin && (
            user.role === 'moderator' ? (
              <button type="button" className="mon__btn" disabled={busy || user.roleFromEnv}
                title={user.roleFromEnv ? t('admin.users.roleFromEnv') : undefined}
                onClick={() => run(() => adminApi.updateUser(user.id, { role: 'user' }), t('admin.saved'))}>
                <FontAwesomeIcon icon={faUserShield} /> {t('admin.users.revokeModerator')}
              </button>
            ) : (
              <button type="button" className="mon__btn" disabled={busy}
                onClick={() => run(() => adminApi.updateUser(user.id, { role: 'moderator' }), t('admin.saved'))}>
                <FontAwesomeIcon icon={faUserShield} /> {t('admin.users.makeModerator')}
              </button>
            )
          )}
          {user.locked && (
            <button type="button" className="mon__btn" disabled={busy} onClick={() => run(() => adminApi.unlock(user.id), t('monitoring.unlocked'))}>
              <FontAwesomeIcon icon={faLockOpen} /> {t('monitoring.unlock')}
            </button>
          )}
          <button type="button" className="mon__btn" disabled={busy}
            onClick={async () => (await confirm({ title: t('monitoring.confirmLogout') })) && run(() => adminApi.logoutEverywhere(user.id), t('monitoring.loggedOut'))}>
            <FontAwesomeIcon icon={faRightFromBracket} /> {t('monitoring.logoutEverywhere')}
          </button>
        </div>
      </div>

      {!user.isAdmin && (
        <div className="adm__panel adm__panel--danger">
          <h3><FontAwesomeIcon icon={faBan} /> {t('admin.users.ban')}</h3>
          {user.banned ? (
            <>
              <p className="adm__muted">{t('admin.users.bannedSince', { date: fmtDate(user.bannedAt) })}{user.banReason ? ` — ${user.banReason}` : ''}</p>
              <button type="button" className="mon__btn" disabled={busy} onClick={() => run(() => adminApi.unban(user.id), t('admin.users.unbanned'))}>
                {t('admin.users.unban')}
              </button>
            </>
          ) : (
            <div className="adm__row">
              <input className="adm__input" value={banReason} onChange={(e) => setBanReason(e.target.value)} maxLength={300}
                placeholder={t('admin.users.banReason')} />
              <button type="button" className="mon__btn adm__danger" disabled={busy}
                onClick={async () => (await confirm({ title: t('admin.users.banConfirm', { name: user.username }), danger: true }))
                  && run(() => adminApi.ban(user.id, banReason), t('admin.users.bannedOk'))}>
                <FontAwesomeIcon icon={faBan} /> {t('admin.users.ban')}
              </button>
            </div>
          )}
          <hr />
          <button type="button" className="mon__btn adm__danger" disabled={busy}
            onClick={async () => {
              const ok = await confirm({ title: t('admin.users.deleteConfirm', { name: user.username }), message: t('admin.users.deleteHint'), danger: true });
              if (!ok) return;
              try {
                await adminApi.deleteUser(user.id);
                toast.success(t('admin.deleted'));
                onDeleted();
              } catch (e) {
                toast.error(errText(e));
              }
            }}>
            <FontAwesomeIcon icon={faTrash} /> {t('admin.users.delete')}
          </button>
        </div>
      )}
    </div>
  );
};

/* ---------- Жеке хабарламалар ---------- */

const UserMessages: React.FC<{ user: AdminUser }> = ({ user }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [peer, setPeer] = useState<Person | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi.conversations(user.id).then((r) => setItems(r.items)).catch((e) => setError(errText(e)));
  }, [user.id]);

  if (peer) return <ConversationView me={user} peer={peer} onBack={() => setPeer(null)} />;
  if (error) return <div className="mon__error">{error}</div>;
  if (!items) return <p className="mon__empty">{t('common.loading', { defaultValue: '…' })}</p>;
  if (!items.length) return <p className="mon__empty">{t('monitoring.none')}</p>;
  return (
    <>
      <p className="adm__notice">{t('admin.privacyNote')}</p>
      <ul className="adm__list">
        {items.map((c) => (
          <li key={c.peer.id}>
            <button type="button" className="adm__list-btn" onClick={() => setPeer(c.peer)}>
              <b>@{c.peer.username}</b>
              <span className="adm__muted">{t('admin.users.messagesCount', { count: c.count })} · {fmtDate(c.lastAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

const ConversationView: React.FC<{ me: AdminUser; peer: Person; onBack: () => void }> = ({ me, peer, onBack }) => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => {
    adminApi.conversation(me.id, peer.id).then((r) => setMsgs(r.messages)).catch((e) => toast.error(errText(e)));
  }, [me.id, peer.id, toast]);

  const save = async () => {
    if (!editing) return;
    try {
      const updated = await adminApi.editMessage(editing.id, editing.text);
      setMsgs((prev) => prev && prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
      toast.success(t('admin.saved'));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const remove = async (m: ChatMsg) => {
    if (!(await confirm({ title: t('admin.messages.deleteConfirm'), danger: true }))) return;
    try {
      await adminApi.deleteMessage(m.id);
      setMsgs((prev) => prev && prev.filter((x) => x.id !== m.id));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  return (
    <div className="adm__stack">
      <button type="button" className="mon__btn adm__back" onClick={onBack}>
        <FontAwesomeIcon icon={faArrowLeft} /> @{me.username} ↔ @{peer.username}
      </button>
      {!msgs ? <p className="mon__empty">{t('common.loading', { defaultValue: '…' })}</p> : (
        <div className="adm__chat">
          {msgs.length === 0 && <p className="mon__empty">{t('monitoring.none')}</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`adm__msg${m.fromUserId === me.id ? ' is-me' : ''}`}>
              <div className="adm__msg-meta">
                <b>@{m.fromUserId === me.id ? me.username : peer.username}</b>
                <span>{fmtDate(m.createdAt)}{m.editedAt ? ` · ${t('admin.messages.edited')}` : ''}</span>
              </div>
              {editing?.id === m.id ? (
                <div className="adm__stack">
                  <textarea className="adm__input" rows={3} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                  <div className="adm__row">
                    <button type="button" className="mon__btn adm__primary" onClick={save} disabled={!editing.text.trim()}>{t('admin.save')}</button>
                    <button type="button" className="mon__btn" onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              ) : (
                <div className="adm__msg-body">
                  {m.content || <i className="adm__muted">[{m.type || 'media'}]</i>}
                </div>
              )}
              {editing?.id !== m.id && (
                <div className="adm__msg-actions">
                  {(!m.type || m.type === 'text') && (
                    <button type="button" className="mon__icon-btn" title={t('admin.edit')} onClick={() => setEditing({ id: m.id, text: m.content })}>
                      <FontAwesomeIcon icon={faPen} />
                    </button>
                  )}
                  <button type="button" className="mon__icon-btn" title={t('admin.delete')} onClick={() => remove(m)}>
                    <FontAwesomeIcon icon={faTrash} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------- Notes ---------- */

const UserNotes: React.FC<{ user: AdminUser }> = ({ user }) => {
  const { t } = useTranslation();
  const toast = useAdminToast();
  const confirm = useConfirm();
  const [items, setItems] = useState<NoteMeta[] | null>(null);
  const [open, setOpen] = useState<NoteFull | null>(null);
  const [draft, setDraft] = useState({ title: '', content: '' });

  useEffect(() => {
    adminApi.notes(user.id).then((r) => setItems(r.items)).catch((e) => toast.error(errText(e)));
  }, [user.id, toast]);

  const openNote = async (id: string) => {
    try {
      const n = await adminApi.note(id);
      setOpen(n);
      setDraft({ title: n.title, content: n.content });
    } catch (e) {
      toast.error(errText(e));
    }
  };

  if (open) {
    const dirty = draft.title !== open.title || draft.content !== open.content;
    return (
      <div className="adm__stack">
        <button type="button" className="mon__btn adm__back" onClick={() => setOpen(null)}>
          <FontAwesomeIcon icon={faArrowLeft} /> {open.folder ? `${open.folder}/` : ''}{open.title}
        </button>
        <input className="adm__input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200} />
        <textarea className="adm__input adm__code" rows={18} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        <div className="adm__row">
          <button type="button" className="mon__btn adm__primary" disabled={!dirty}
            onClick={async () => {
              try {
                const n = await adminApi.updateNote(open.id, { title: draft.title, content: draft.content });
                setOpen(n);
                setItems((prev) => prev && prev.map((x) => (x.id === n.id ? { ...x, title: n.title } : x)));
                toast.success(t('admin.saved'));
              } catch (e) {
                toast.error(errText(e));
              }
            }}>
            <FontAwesomeIcon icon={faFloppyDisk} /> {t('admin.save')}
          </button>
          <button type="button" className="mon__btn adm__danger"
            onClick={async () => {
              if (!(await confirm({ title: t('admin.notes.deleteConfirm', { title: open.title }), danger: true }))) return;
              try {
                await adminApi.deleteNote(open.id);
                setItems((prev) => prev && prev.filter((x) => x.id !== open.id));
                setOpen(null);
                toast.success(t('admin.deleted'));
              } catch (e) {
                toast.error(errText(e));
              }
            }}>
            <FontAwesomeIcon icon={faTrash} /> {t('admin.delete')}
          </button>
        </div>
      </div>
    );
  }

  if (!items) return <p className="mon__empty">{t('common.loading', { defaultValue: '…' })}</p>;
  if (!items.length) return <p className="mon__empty">{t('monitoring.none')}</p>;
  return (
    <>
      <p className="adm__notice">{t('admin.privacyNote')}</p>
      <ul className="adm__list">
        {items.map((n) => (
          <li key={n.id}>
            <button type="button" className="adm__list-btn" onClick={() => openNote(n.id)}>
              <b>{n.title}</b>
              <span className="adm__muted">{n.folder || '/'} · {n.kind} · {fmtDate(n.updatedAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
};

/* ---------- Vibecoding ---------- */

const UserVibecoding: React.FC<{ user: AdminUser }> = ({ user }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<AdminVibeRow[] | null>(null);
  useEffect(() => {
    adminApi.vibecoding({ ownerId: user.id, limit: 200 }).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [user.id]);
  if (!items) return <p className="mon__empty">{t('common.loading', { defaultValue: '…' })}</p>;
  if (!items.length) return <p className="mon__empty">{t('monitoring.none')}</p>;
  return (
    <ul className="adm__list">
      {items.map((p) => (
        <li key={p.id}>
          <Link className="adm__list-btn" to={`/admin/vibecoding/${encodeURIComponent(p.id)}`}>
            <b>{p.name}</b>
            <span className="adm__muted">{t('admin.vibe.filesCount', { count: p.files })} · {fmtDate(p.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
};

export default AdminUsers;
