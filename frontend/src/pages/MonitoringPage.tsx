import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChartLine, faPause, faPlay, faRotateRight, faLockOpen, faRightFromBracket,
  faCircleCheck, faTriangleExclamation, faCircleXmark,
} from '@fortawesome/free-solid-svg-icons';
import { apiService } from '../utils/api';
import type { MonitoringEvent, MonitoringOverview } from '../utils/api';
import './MonitoringPage.css';

/* Сайт мониторингі (тек әкімшілерге, ADMIN_USER_IDS): сұраныстар, қателер, кіру қауіпсіздігі,
   сервер жүктемесі және оқиғалар журналы. 10 секунд сайын жаңарады. */

const REFRESH_MS = 10_000;
const SEVERITIES = ['', 'error', 'warn', 'info'] as const;
const KINDS = [
  '', 'login_ok', 'login_fail', 'login_unknown_user', 'account_locked', 'login_code_sent', 'login_code_fail',
  'login_code_locked', 'login_code_ok', 'new_device', 'register',
  '2fa_fail', 'refresh_reuse', 'rate_limited', 'server_error', 'alert', 'admin_action',
  'test_code_bypass', 'email_change_requested', 'email_change_code_fail', 'email_changed',
];

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};
const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString());

const SevIcon: React.FC<{ s: MonitoringEvent['severity'] }> = ({ s }) => (
  <FontAwesomeIcon
    className={`mon__sev mon__sev--${s}`}
    icon={s === 'error' ? faCircleXmark : s === 'warn' ? faTriangleExclamation : faCircleCheck}
  />
);

/* Минут сайынғы сұраныстар: сәтті + 5xx қабаттасқан бағандар, әр бағанда tooltip */
const RequestsChart: React.FC<{ series: MonitoringOverview['requests']['series'] }> = ({ series }) => {
  const { t } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 180, padL = 36, padB = 22, padT = 8;
  const max = Math.max(1, ...series.map((p) => p.requests));
  const nice = (() => {
    const p = Math.pow(10, Math.floor(Math.log10(max)));
    return Math.ceil(max / p) * p;
  })();
  const plotW = W - padL, plotH = H - padB - padT;
  const bw = plotW / series.length;
  const y = (v: number) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 2, nice];
  const hp = hover !== null ? series[hover] : null;

  return (
    <div className="mon__chart">
      <div className="mon__legend">
        <span><i className="mon__swatch mon__swatch--ok" />{t('monitoring.chart.ok')}</span>
        <span><i className="mon__swatch mon__swatch--err" />{t('monitoring.chart.errors')}</span>
      </div>
      <div className="mon__chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('monitoring.chart.title')} onMouseLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="mon__grid" />
              <text x={padL - 6} y={y(v) + 4} className="mon__axis" textAnchor="end">{v}</text>
            </g>
          ))}
          {series.map((p, i) => {
            const x = padL + i * bw + 1;
            const w = Math.max(1, bw - 2);
            const ok = p.requests - p.errors;
            const hOk = (ok / nice) * plotH;
            const hErr = (p.errors / nice) * plotH;
            const base = padT + plotH;
            return (
              <g key={p.t} onMouseEnter={() => setHover(i)}>
                <rect x={padL + i * bw} y={padT} width={bw} height={plotH} fill="transparent" />
                {hOk > 0 && <rect x={x} y={base - hOk} width={w} height={hOk} rx={Math.min(2, w / 2)} className="mon__bar-ok" />}
                {hErr > 0 && (
                  <rect x={x} y={base - hOk - hErr - (hOk > 0 ? 2 : 0)} width={w} height={hErr} rx={Math.min(2, w / 2)} className="mon__bar-err" />
                )}
              </g>
            );
          })}
          {[0, 15, 30, 45, 59].map((i) => series[i] && (
            <text key={i} x={padL + i * bw + bw / 2} y={H - 6} className="mon__axis" textAnchor="middle">
              {new Date(series[i].t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </text>
          ))}
          {hover !== null && <line x1={padL + hover * bw + bw / 2} x2={padL + hover * bw + bw / 2} y1={padT} y2={padT + plotH} className="mon__cross" />}
        </svg>
        {hp && (
          <div className="mon__tip" style={{ left: `${((padL + (hover! + 0.5) * bw) / W) * 100}%` }}>
            <b>{new Date(hp.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>
            <span>{t('monitoring.chart.requests')}: {hp.requests}</span>
            <span>{t('monitoring.chart.errors')}: {hp.errors}</span>
            <span>4xx: {hp.clientErrors}</span>
          </div>
        )}
      </div>
    </div>
  );
};

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'bad' | 'warn' }> = ({ label, value, hint, tone }) => (
  <div className={`mon__tile${tone ? ` mon__tile--${tone}` : ''}`}>
    <span className="mon__tile-label">{label}</span>
    <span className="mon__tile-value">
      {tone === 'bad' && <FontAwesomeIcon icon={faCircleXmark} />}
      {tone === 'warn' && <FontAwesomeIcon icon={faTriangleExclamation} />}
      {value}
    </span>
    {hint && <span className="mon__tile-hint">{hint}</span>}
  </div>
);

const MonitoringPage: React.FC = () => {
  const { t } = useTranslation();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [events, setEvents] = useState<MonitoringEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [severity, setSeverity] = useState('');
  const [kind, setKind] = useState('');
  const [ipFilter, setIpFilter] = useState('');
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const filtersRef = useRef({ severity, kind, ipFilter });
  filtersRef.current = { severity, kind, ipFilter };

  useEffect(() => {
    apiService.getAdminMe().then((r) => setAllowed(r.isAdmin)).catch(() => setAllowed(false));
  }, []);

  const load = useCallback(async () => {
    const f = filtersRef.current;
    try {
      const [ov, ev] = await Promise.all([
        apiService.getMonitoringOverview(),
        apiService.getMonitoringEvents({ severity: f.severity, kind: f.kind, ip: f.ipFilter.trim(), limit: 100 }),
      ]);
      setData(ov);
      setEvents(ev.events);
      setHasMore(ev.events.length === 100);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load, severity, kind]);

  useEffect(() => {
    if (!allowed || !live) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [allowed, live, load]);

  const loadMore = async () => {
    const last = events[events.length - 1];
    if (!last) return;
    const ev = await apiService.getMonitoringEvents({ severity, kind, ip: ipFilter.trim(), beforeId: last.id, limit: 100 });
    setEvents((prev) => [...prev, ...ev.events]);
    setHasMore(ev.events.length === 100);
  };

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    try {
      await fn();
      setNotice(okMsg);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sec = data?.security24h;
  const req = data?.requests;
  const kindLabel = useMemo(() => (k: string) => t(`monitoring.kinds.${k}`, { defaultValue: k }), [t]);

  if (allowed === null) return <div className="mon mon--center">{t('common.loading', { defaultValue: '…' })}</div>;
  if (!allowed) {
    return (
      <div className="mon mon--center">
        <p>{t('monitoring.noAccess')}</p>
        <Link to="/">{t('monitoring.home')}</Link>
      </div>
    );
  }

  return (
    <div className="mon">
      <header className="mon__top">
        <div>
          <h1><FontAwesomeIcon icon={faChartLine} /> {t('monitoring.title')}</h1>
          <p>
            {data ? t('monitoring.updated', { time: new Date(data.generatedAt).toLocaleTimeString(), uptime: fmtUptime(data.uptimeSeconds) }) : '…'}
          </p>
        </div>
        <div className="mon__controls">
          <button type="button" className="mon__btn" onClick={() => setLive((v) => !v)} aria-pressed={live}>
            <FontAwesomeIcon icon={live ? faPause : faPlay} /> {live ? t('monitoring.pause') : t('monitoring.resume')}
          </button>
          <button type="button" className="mon__btn" onClick={load}>
            <FontAwesomeIcon icon={faRotateRight} /> {t('monitoring.refresh')}
          </button>
        </div>
      </header>

      {error && <div className="mon__error">{error}</div>}
      {notice && <div className="mon__notice" onClick={() => setNotice(null)}>{notice}</div>}

      {data && req && sec && (
        <>
          <section className="mon__tiles">
            <Tile label={t('monitoring.tiles.requests')} value={fmtNum(req.total)} hint={t('monitoring.tiles.lastHour')} />
            <Tile label={t('monitoring.tiles.errorRate')} value={`${req.errorRate}%`} hint={`5xx: ${req.serverErrors}`}
              tone={req.errorRate >= 5 ? 'bad' : req.errorRate >= 1 ? 'warn' : undefined} />
            <Tile label={t('monitoring.tiles.latency')} value={`${req.p95Ms} ms`} hint={`p50 ${req.p50Ms} · p99 ${req.p99Ms}`}
              tone={req.p95Ms >= 1500 ? 'warn' : undefined} />
            <Tile label={t('monitoring.tiles.online')} value={fmtNum(data.users.onlineNow)}
              hint={t('monitoring.tiles.usersTotal', { count: data.users.total })} />
            <Tile label={t('monitoring.tiles.loginFail')} value={fmtNum(sec.loginFail)} hint={t('monitoring.tiles.loginOk', { count: sec.loginOk })}
              tone={sec.loginFail >= 50 ? 'bad' : sec.loginFail >= 10 ? 'warn' : undefined} />
            <Tile label={t('monitoring.tiles.locked')} value={fmtNum(sec.lockedAccountsNow)} hint={t('monitoring.tiles.locked24h', { count: sec.accountLocked })}
              tone={sec.lockedAccountsNow > 0 ? 'warn' : undefined} />
            <Tile label={t('monitoring.tiles.codes')} value={fmtNum(sec.codesSent)} hint={t('monitoring.tiles.codeFails', { count: sec.codeFails })} />
            <Tile label={t('monitoring.tiles.alerts')} value={fmtNum(sec.alerts)} hint={t('monitoring.tiles.refreshReuse', { count: sec.refreshReuse })}
              tone={sec.alerts > 0 || sec.refreshReuse > 0 ? 'bad' : undefined} />
          </section>

          <section className="mon__card">
            <h2>{t('monitoring.chart.title')}</h2>
            <RequestsChart series={req.series} />
          </section>

          <div className="mon__grid2">
            <section className="mon__card">
              <h2>{t('monitoring.ips')}</h2>
              {sec.topIps.length === 0 ? <p className="mon__empty">{t('monitoring.none')}</p> : (
                <table className="mon__table">
                  <tbody>
                    {sec.topIps.map((x) => (
                      <tr key={x.ip}>
                        <td><button type="button" className="mon__link" onClick={() => { setIpFilter(x.ip); setTimeout(load); }}>{x.ip}</button></td>
                        <td className="mon__num">{x.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="mon__card">
              <h2>{t('monitoring.system')}</h2>
              <table className="mon__table">
                <tbody>
                  <tr><td>{t('monitoring.sys.memory')}</td><td className="mon__num">{data.system.memoryMb !== null ? `${data.system.memoryMb} MB` : '—'}</td></tr>
                  <tr><td>CPU</td><td className="mon__num">{data.system.cpuPercent !== null ? `${data.system.cpuPercent}%` : '—'}</td></tr>
                  <tr><td>{t('monitoring.sys.disk')}</td><td className="mon__num">{data.system.disk ? `${data.system.disk.usedPercent}% · ${data.system.disk.freeGb} GB free` : '—'}</td></tr>
                  <tr><td>{t('monitoring.sys.db')}</td><td className="mon__num">{data.system.dbSizeMb ?? '—'} MB</td></tr>
                  <tr><td>{t('monitoring.sys.uploads')}</td><td className="mon__num">{data.system.uploadsSizeMb} MB</td></tr>
                  <tr><td>WebSocket</td><td className="mon__num">{data.users.wsConnections}</td></tr>
                  <tr><td>{t('monitoring.sys.terminals')}</td><td className="mon__num">{fmtNum(data.users.activeTerminals)}</td></tr>
                </tbody>
              </table>
            </section>
          </div>

          <div className="mon__grid2">
            <section className="mon__card">
              <h2>{t('monitoring.topRoutes')}</h2>
              <RoutesTable rows={req.topRoutes} />
            </section>
            <section className="mon__card">
              <h2>{t('monitoring.slowRoutes')}</h2>
              <RoutesTable rows={req.slowRoutes} />
            </section>
          </div>
        </>
      )}

      <section className="mon__card">
        <h2>{t('monitoring.events')}</h2>
        <div className="mon__filters">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label={t('monitoring.severity')}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s ? t(`monitoring.sev.${s}`) : t('monitoring.allSeverities')}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t('monitoring.kind')}>
            {KINDS.map((k) => <option key={k} value={k}>{k ? kindLabel(k) : t('monitoring.allKinds')}</option>)}
          </select>
          <input
            value={ipFilter}
            onChange={(e) => setIpFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="IP"
            aria-label="IP"
          />
          {ipFilter && <button type="button" className="mon__btn" onClick={() => { setIpFilter(''); setTimeout(load); }}>✕</button>}
        </div>
        <div className="mon__scroll">
          <table className="mon__table mon__events">
            <thead>
              <tr>
                <th>{t('monitoring.col.time')}</th>
                <th>{t('monitoring.col.event')}</th>
                <th>{t('monitoring.col.user')}</th>
                <th>IP</th>
                <th>{t('monitoring.col.detail')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={`is-${e.severity}`}>
                  <td className="mon__nowrap">{fmtTime(e.at)}</td>
                  <td className="mon__nowrap"><SevIcon s={e.severity} /> {kindLabel(e.kind)}</td>
                  <td>{e.username ? <Link to={`/profile/${e.username}`}>@{e.username}</Link> : e.userId || '—'}</td>
                  <td className="mon__mono">{e.ip || '—'}</td>
                  <td className="mon__detail">{e.detail ? (typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)) : ''}</td>
                  <td className="mon__nowrap">
                    {e.userId && ['account_locked', 'login_fail'].includes(e.kind) && (
                      <button type="button" className="mon__icon-btn" title={t('monitoring.unlock')}
                        onClick={() => act(() => apiService.adminUnlockUser(e.userId!), t('monitoring.unlocked'))}>
                        <FontAwesomeIcon icon={faLockOpen} />
                      </button>
                    )}
                    {e.userId && ['login_fail', 'login_code_fail', 'refresh_reuse', 'new_device', 'account_locked'].includes(e.kind) && (
                      <button type="button" className="mon__icon-btn" title={t('monitoring.logoutEverywhere')}
                        onClick={() => window.confirm(t('monitoring.confirmLogout')) &&
                          act(() => apiService.adminLogoutEverywhere(e.userId!), t('monitoring.loggedOut'))}>
                        <FontAwesomeIcon icon={faRightFromBracket} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <p className="mon__empty">{t('monitoring.none')}</p>}
        </div>
        {hasMore && <button type="button" className="mon__btn mon__more" onClick={loadMore}>{t('monitoring.more')}</button>}
      </section>
    </div>
  );
};

const RoutesTable: React.FC<{ rows: MonitoringOverview['requests']['topRoutes'] }> = ({ rows }) => {
  const { t } = useTranslation();
  if (!rows.length) return <p className="mon__empty">{t('monitoring.none')}</p>;
  return (
    <div className="mon__scroll">
      <table className="mon__table">
        <thead>
          <tr><th>{t('monitoring.col.route')}</th><th className="mon__num">#</th><th className="mon__num">avg</th><th className="mon__num">max</th><th className="mon__num">5xx</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td className="mon__mono mon__route">{r.route}</td>
              <td className="mon__num">{r.count}</td>
              <td className="mon__num">{r.avgMs}</td>
              <td className="mon__num">{r.maxMs}</td>
              <td className={`mon__num${r.errors ? ' mon__bad' : ''}`}>{r.errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default MonitoringPage;
