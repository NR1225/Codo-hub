import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartLine, faUsers, faFolderOpen, faCircleNotch, faUserGroup, faWandMagicSparkles, faScrewdriverWrench, faLock,
} from '@fortawesome/free-solid-svg-icons';
import { ADMIN_STEPUP_EVENT, AdminMe, apiService } from '../utils/api';
import { StepUp, TwoFactorRequired } from '../components/admin/AdminGate';
import { adminApi, AdminStats } from '../components/admin/adminApi';
import { AdminToastProvider } from '../components/admin/AdminShared';
import './MonitoringPage.css';
import './AdminPage.css';

/* Әкімші панелі (тек ADMIN_USER_IDS): /admin/<бөлім>/<id?>
   Мониторинг · Қолданушылар · Жобалар · Сторис · Топтар · Vibecoding */

const MonitoringPage = lazy(() => import('./MonitoringPage'));
const AdminUsers = lazy(() => import('../components/admin/AdminUsers'));
const AdminProjects = lazy(() => import('../components/admin/AdminProjects'));
const AdminStories = lazy(() => import('../components/admin/AdminStories'));
const AdminGroups = lazy(() => import('../components/admin/AdminGroups'));
const AdminVibecoding = lazy(() => import('../components/admin/AdminVibecoding'));

const SECTIONS = [
  { key: 'monitoring', icon: faChartLine },
  { key: 'users', icon: faUsers },
  { key: 'projects', icon: faFolderOpen },
  { key: 'stories', icon: faCircleNotch },
  { key: 'groups', icon: faUserGroup },
  { key: 'vibecoding', icon: faWandMagicSparkles },
] as const;
type Section = typeof SECTIONS[number]['key'];

const STAT_FOR: Partial<Record<Section, keyof AdminStats>> = {
  users: 'users', projects: 'projects', stories: 'stories', groups: 'groups', vibecoding: 'vibecoding',
};

const AdminPage: React.FC = () => {
  const { t } = useTranslation();
  const { section, itemId } = useParams<{ section?: string; itemId?: string }>();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const allowed = me === null ? null : me.isAdmin;
  const ready = !!(me?.isAdmin && me.verified);

  const refreshMe = useCallback(() => {
    apiService.getAdminMe().then(setMe).catch(() => setMe({ isAdmin: false }));
  }, []);
  useEffect(refreshMe, [refreshMe]);

  // Растаудың мерзімі өтсе (сервер 403 қайтарса немесе уақыты бітсе) — растау терезесіне ораламыз
  useEffect(() => {
    const onExpired = () => setMe((m) => (m ? { ...m, verified: false } : m));
    window.addEventListener(ADMIN_STEPUP_EVENT, onExpired);
    return () => window.removeEventListener(ADMIN_STEPUP_EVENT, onExpired);
  }, []);
  useEffect(() => {
    if (!ready || !me?.expiresAt) return;
    const ms = new Date(me.expiresAt).getTime() - Date.now();
    const id = window.setTimeout(refreshMe, Math.max(1000, ms + 1000));
    return () => window.clearTimeout(id);
  }, [ready, me?.expiresAt, refreshMe]);

  useEffect(() => {
    if (ready) adminApi.stats().then(setStats).catch(() => {});
  }, [ready, section]);

  const lock = async () => {
    await apiService.adminStepUpEnd().catch(() => {});
    refreshMe();
  };

  if (!section) return <Navigate to="/admin/monitoring" replace />;
  if (!SECTIONS.some((s) => s.key === section)) return <Navigate to="/admin/monitoring" replace />;
  if (allowed === null) return <div className="mon mon--center">{t('common.loading', { defaultValue: '…' })}</div>;
  if (!allowed) {
    return (
      <div className="mon mon--center">
        <p>{t('monitoring.noAccess')}</p>
        <Link to="/">{t('monitoring.home')}</Link>
      </div>
    );
  }

  if (me?.requires2fa) return <div className="mon"><TwoFactorRequired /></div>;
  if (!ready) return <div className="mon"><StepUp me={me!} onVerified={refreshMe} /></div>;

  const current = section as Section;
  return (
    <AdminToastProvider>
      <div className="mon adm">
        <header className="adm__head">
          <div>
            <h1><FontAwesomeIcon icon={faScrewdriverWrench} /> {t('admin.title')}</h1>
            {stats && (
              <p className="adm__muted">
                {t('admin.summary', { users: stats.users, banned: stats.banned, messages: stats.messages, notes: stats.notes, files: stats.files })}
              </p>
            )}
          </div>
          <div className="adm__session">
            {me?.expiresAt && (
              <span className="adm__muted">
                {t('admin.gate.until', { time: new Date(me.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}
              </span>
            )}
            <button type="button" className="mon__btn" onClick={lock}>
              <FontAwesomeIcon icon={faLock} /> {t('admin.gate.lock')}
            </button>
          </div>
        </header>
        <nav className="adm__tabs" aria-label={t('admin.title')}>
          {SECTIONS.map((s) => {
            const stat = STAT_FOR[s.key];
            return (
              <NavLink key={s.key} to={`/admin/${s.key}`} className={({ isActive }) => `adm__tab${isActive ? ' is-active' : ''}`}>
                <FontAwesomeIcon icon={s.icon} /> {t(`admin.nav.${s.key}`)}
                {stats && stat && <span className="adm__count">{stats[stat]}</span>}
              </NavLink>
            );
          })}
        </nav>
        <Suspense fallback={<p className="mon__empty">{t('common.loading', { defaultValue: '…' })}</p>}>
          {current === 'monitoring' && <MonitoringPage embedded />}
          {current === 'users' && <AdminUsers itemId={itemId} />}
          {current === 'projects' && <AdminProjects itemId={itemId} />}
          {current === 'stories' && <AdminStories />}
          {current === 'groups' && <AdminGroups itemId={itemId} />}
          {current === 'vibecoding' && <AdminVibecoding itemId={itemId} />}
        </Suspense>
      </div>
    </AdminToastProvider>
  );
};

export default AdminPage;
