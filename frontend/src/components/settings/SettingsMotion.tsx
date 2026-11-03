import React from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faMicrochip, faRotate, faMobileScreen, faTabletScreenButton, faLaptop, faDesktop, faBan,
} from '@fortawesome/free-solid-svg-icons';
import { MOTION_DEFS, MOTION_GROUPS, useMotion } from '../../contexts/MotionContext';

const KIND_ICON = {
  phone: faMobileScreen,
  tablet: faTabletScreenButton,
  laptop: faLaptop,
  desktop: faDesktop,
} as const;

/** Баптаулар → «Анимациялар»: құрылғы бағасы және әр беттің анимациясы бөлек. */
const SettingsMotion: React.FC = () => {
  const { t } = useTranslation();
  const m = useMotion();
  const { profile } = m;
  const key = (id: string) => id.replace('.', '_');
  const hasOverrides = MOTION_DEFS.some((d) => m.override(d.id) !== undefined) || !m.master;

  const stat = (label: string, value: React.ReactNode) => (
    <div className="stg-motion__stat">
      <span className="stg-motion__stat-label">{label}</span>
      <span className="stg-motion__stat-value">{value}</span>
    </div>
  );

  return (
    <div className="stg-stack">
      <section className="stg-card stg-motion__device">
        <h2 className="stg-card__title">
          <FontAwesomeIcon icon={KIND_ICON[profile.kind]} /> {t('motion.deviceTitle')}
          <span className={`stg-motion__tier is-${profile.tier}`}>{t(`motion.tier.${profile.tier}`)}</span>
        </h2>
        <p className="stg-motion__hint">
          {t(`motion.kind.${profile.kind}`)} · {t(`motion.tierHint.${profile.tier}`)}
        </p>
        {profile.reducedMotion && <p className="stg-msg stg-msg--warning">{t('motion.reducedMotion')}</p>}
        <div className="stg-motion__stats">
          {stat(t('motion.cores'), profile.cores ?? t('motion.unknown'))}
          {stat(t('motion.memory'), profile.memory ? `${profile.memory} GB+` : t('motion.unknown'))}
          {stat(t('motion.fps'), profile.fps ? `${profile.fps} FPS` : t('motion.unknown'))}
          {stat(t('motion.gpu'), <span title={profile.gpu ?? ''}>{profile.gpu ?? t('motion.unknown')}</span>)}
        </div>
        <div className="stg-actions">
          <button type="button" className="stg-btn stg-btn--ghost" onClick={() => void m.recheck()} disabled={m.checking}>
            <FontAwesomeIcon icon={m.checking ? faMicrochip : faRotate} spin={m.checking} />
            {m.checking ? t('motion.checking') : t('motion.recheck')}
          </button>
          {hasOverrides && (
            <button type="button" className="stg-btn stg-btn--ghost" onClick={m.resetAll}>
              {t('motion.resetAll')}
            </button>
          )}
        </div>
      </section>

      <section className="stg-card">
        <label className="stg-switch-row">
          <span className="stg-motion__row-text">
            <span className="stg-motion__row-title">{t('motion.masterTitle')}</span>
            <span className="stg-motion__row-desc">{t('motion.masterDesc')}</span>
          </span>
          <input
            type="checkbox"
            className="stg-switch"
            checked={m.master}
            onChange={(e) => m.setMaster(e.target.checked)}
          />
        </label>
      </section>

      <div className={`stg-grid stg-motion__groups${m.master ? '' : ' is-disabled'}`}>
        {MOTION_GROUPS.map((group) => {
          const defs = MOTION_DEFS.filter((d) => d.group === group);
          if (!defs.length) return null;
          return (
            <section key={group} className="stg-card">
              <h2 className="stg-card__title">{t(`motion.groups.${group}`)}</h2>
              {defs.map((def) => {
                const supported = m.isSupported(def.id);
                const isAuto = m.override(def.id) === undefined;
                const on = m.isOn(def.id);
                return (
                  <label
                    key={def.id}
                    className={`stg-switch-row stg-motion__row${supported ? '' : ' is-unsupported'}`}
                    title={supported ? undefined : t('motion.unsupported')}
                  >
                    <span className="stg-motion__row-text">
                      <span className="stg-motion__row-title">
                        {t(`motion.items.${key(def.id)}.title`)}
                        <span className={`stg-motion__cost is-${def.cost}`}>{t(`motion.cost.${def.cost}`)}</span>
                        {supported && isAuto && (
                          <span className="stg-motion__auto" title={t('motion.autoHint')}>{t('motion.auto')}</span>
                        )}
                      </span>
                      <span className="stg-motion__row-desc">{t(`motion.items.${key(def.id)}.desc`)}</span>
                      {!supported && (
                        <span className="stg-motion__unsupported">
                          <FontAwesomeIcon icon={faBan} /> {t('motion.unsupported')}
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      className="stg-switch"
                      checked={on}
                      disabled={!supported || !m.master}
                      onChange={(e) => m.setOverride(def.id, e.target.checked)}
                    />
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default SettingsMotion;
