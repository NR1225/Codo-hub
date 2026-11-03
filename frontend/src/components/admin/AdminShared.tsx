import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons';
import { errText, Paged, Person } from './adminApi';

export const PAGE_SIZE = 50;

/** Беттелген тізім: offset, жүктелу, қате, қайта жүктеу */
export function usePaged<T>(fetcher: (offset: number) => Promise<Paged<T>>, deps: React.DependencyList) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Paged<T>>({ total: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback(async (at: number) => {
    setLoading(true);
    try {
      setData(await fetchRef.current(at));
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Сүзгі өзгерсе — бірінші бетке
  useEffect(() => {
    setOffset(0);
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const go = (at: number) => { setOffset(at); load(at); };
  return { ...data, offset, loading, error, reload: () => load(offset), go };
}

export const Pager: React.FC<{ total: number; offset: number; go: (at: number) => void }> = ({ total, offset, go }) => {
  const { t } = useTranslation();
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="adm__pager">
      <button type="button" className="mon__btn" disabled={offset === 0} onClick={() => go(Math.max(0, offset - PAGE_SIZE))}
        aria-label={t('admin.prev')}>
        <FontAwesomeIcon icon={faChevronLeft} />
      </button>
      <span>{offset + 1}–{Math.min(total, offset + PAGE_SIZE)} / {total}</span>
      <button type="button" className="mon__btn" disabled={offset + PAGE_SIZE >= total} onClick={() => go(offset + PAGE_SIZE)}
        aria-label={t('admin.next')}>
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
    </div>
  );
};

/** Іздеу өрісі: Enter басқанда немесе 400 мс кідірістен соң іздейді */
export const SearchBox: React.FC<{ value: string; onChange: (v: string) => void; placeholder: string }> = ({ value, onChange, placeholder }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (draft === value) return;
    const id = window.setTimeout(() => onChange(draft), 400);
    return () => window.clearTimeout(id);
  }, [draft, value, onChange]);
  return (
    <label className="adm__search">
      <FontAwesomeIcon icon={faMagnifyingGlass} />
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onChange(draft)}
        placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
};

export const PersonTag: React.FC<{ p: Person | null | undefined; onOpen?: (id: string) => void }> = ({ p, onOpen }) => {
  if (!p) return <span className="adm__muted">—</span>;
  if (onOpen) {
    return <button type="button" className="adm__person" onClick={() => onOpen(p.id)}>@{p.username}</button>;
  }
  return <Link className="adm__person" to={`/admin/users/${encodeURIComponent(p.id)}`}>@{p.username}</Link>;
};

/** Оң жақтан ашылатын панель (егжей-тегжейі, өңдеу) */
export const Drawer: React.FC<{ title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({ title, onClose, children, wide }) => {
  const { t } = useTranslation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="adm__drawer-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={`adm__drawer${wide ? ' adm__drawer--wide' : ''}`} role="dialog" aria-modal="true">
        <header className="adm__drawer-head">
          <h2>{title}</h2>
          <button type="button" className="mon__icon-btn" onClick={onClose} aria-label={t('common.close', { defaultValue: 'Close' })}>
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>
        <div className="adm__drawer-body">{children}</div>
      </aside>
    </div>
  );
};

export const ListState: React.FC<{ loading: boolean; error: string | null; empty: boolean }> = ({ loading, error, empty }) => {
  const { t } = useTranslation();
  if (error) return <div className="mon__error">{error}</div>;
  if (loading && empty) return <p className="mon__empty">{t('common.loading', { defaultValue: '…' })}</p>;
  if (empty) return <p className="mon__empty">{t('monitoring.none')}</p>;
  return null;
};

/* ---------- Әкімші панелінің хабарламалары ----------
   Сайттағы toast әдейі өшірілген (contexts/ToastContext.tsx), ал әкімшіге әрекеттің нәтижесі
   көрінуі керек — сондықтан панельдің өз жолағы бар. */

interface AdminToastApi { success: (m: string) => void; error: (m: string) => void }
const AdminToastContext = createContext<AdminToastApi>({ success: () => {}, error: () => {} });
export const useAdminToast = () => useContext(AdminToastContext);

export const AdminToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string; key: number } | null>(null);
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(null), msg.kind === 'err' ? 6000 : 2500);
    return () => window.clearTimeout(id);
  }, [msg]);
  const api = useMemo<AdminToastApi>(() => ({
    success: (text) => setMsg({ kind: 'ok', text, key: Date.now() }),
    error: (text) => setMsg({ kind: 'err', text, key: Date.now() }),
  }), []);
  return (
    <AdminToastContext.Provider value={api}>
      {children}
      {msg && (
        <div key={msg.key} className={`adm__toast adm__toast--${msg.kind}`} role="status" onClick={() => setMsg(null)}>
          {msg.text}
        </div>
      )}
    </AdminToastContext.Provider>
  );
};
