import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLaptopCode, faFolder, faFileCode, faClock, faArrowRight, faPlus } from '@fortawesome/free-solid-svg-icons';
import { apiService, VibecodingProjectDTO } from '../../utils/api';

/* Профильдегі «Vibecoding жобалары»: сайттағы Vibecoding бетінде жасалған жобалар.
   Бұл жобалар жеке (тек иесіне көрінеді), сондықтан тек өз профиліңде көрсетіледі. */

const DEFAULT_NAME_RE = /^Project \d+$/;

/** Ішінде ештеңе жасалмаған жоба — профильде көрсетілмейді */
const isBlank = (p: VibecodingProjectDTO) =>
  p.files.length === 0 && (p.folders?.length ?? 0) === 0 && DEFAULT_NAME_RE.test(p.name.trim());

/** Профильде көрсетілетін жобалар: бостары алынып, соңғы өзгергені бірінші */
export const visibleVibeProjects = (list: VibecodingProjectDTO[]) =>
  list.filter((p) => !isBlank(p)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python', html: 'HTML', css: 'CSS',
  scss: 'SCSS', json: 'JSON', markdown: 'Markdown', java: 'Java', cpp: 'C++', c: 'C', csharp: 'C#',
  go: 'Go', rust: 'Rust', php: 'PHP', ruby: 'Ruby', kotlin: 'Kotlin', swift: 'Swift', sql: 'SQL',
  shell: 'Shell', yaml: 'YAML',
};

/** Жобаның негізгі тілі — файлдары ең көп тіл (plaintext есепке алынбайды) */
function mainLanguage(p: VibecodingProjectDTO): string | null {
  const counts = new Map<string, number>();
  p.files.forEach((f) => {
    const lang = f.language || 'plaintext';
    if (lang !== 'plaintext') counts.set(lang, (counts.get(lang) ?? 0) + 1);
  });
  let best: string | null = null;
  counts.forEach((n, lang) => { if (!best || n > (counts.get(best) ?? 0)) best = lang; });
  return best ? LANGUAGE_LABELS[best] ?? best : null;
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Props {
  onCountChange?: (count: number) => void;
}

const ProfileVibeProjects: React.FC<Props> = ({ onCountChange }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<VibecodingProjectDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    apiService.getVibecodingProjects()
      .then((list) => {
        if (!alive) return;
        const visible = visibleVibeProjects(list);
        setProjects(visible);
        onCountChange?.(visible.length);
      })
      .catch(() => alive && setError(true));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = useMemo(() => (projects ?? []).map((p) => ({
    project: p,
    language: mainLanguage(p),
    updated: formatDate(p.updatedAt || p.createdAt, i18n.language),
  })), [projects, i18n.language]);

  const open = (id: string) => navigate(`/vibecoding?project=${encodeURIComponent(id)}`);

  if (error) {
    return (
      <div className="prf-empty">
        <span className="prf-empty__icon"><FontAwesomeIcon icon={faLaptopCode} /></span>
        <p className="prf-empty__title">{t('profile.vibe.loadError', 'Жобаларды жүктеу мүмкін болмады')}</p>
      </div>
    );
  }

  if (!projects) return <div className="prf-vibe__loading" aria-busy="true" />;

  if (projects.length === 0) {
    return (
      <div className="prf-empty">
        <span className="prf-empty__icon"><FontAwesomeIcon icon={faLaptopCode} /></span>
        <p className="prf-empty__title">{t('profile.vibe.empty', 'Vibecoding жобалары әзірге жоқ')}</p>
        <p className="prf-empty__text">
          {t('profile.vibe.emptyText', 'Vibecoding бетінде жасаған жобаларыңыз осында көрінеді.')}
        </p>
        <div className="prf-empty__actions">
          <button type="button" className="prf-btn prf-btn--primary" onClick={() => navigate('/vibecoding')}>
            <FontAwesomeIcon icon={faPlus} />
            {t('profile.vibe.openVibecoding', 'Vibecoding-ті ашу')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <ul className="prf-vibe">
      {cards.map(({ project, language, updated }, i) => (
        <li key={project.id} style={{ '--d': Math.min(i, 12) } as React.CSSProperties}>
          <button type="button" className="prf-vibe__card" onClick={() => open(project.id)}
            title={t('profile.vibe.open', 'Vibecoding-те ашу')}>
            <span className="prf-vibe__icon"><FontAwesomeIcon icon={faLaptopCode} /></span>
            <span className="prf-vibe__body">
              <span className="prf-vibe__name">{project.name}</span>
              <span className="prf-vibe__meta">
                <span><FontAwesomeIcon icon={faFileCode} />
                  {t('profile.vibe.files', '{{count}} файл', { count: project.files.length })}</span>
                {(project.folders?.length ?? 0) > 0 && (
                  <span><FontAwesomeIcon icon={faFolder} />
                    {t('profile.vibe.folders', '{{count}} папка', { count: project.folders!.length })}</span>
                )}
                {language && <span className="prf-vibe__lang">{language}</span>}
                {updated && <span><FontAwesomeIcon icon={faClock} />{updated}</span>}
              </span>
            </span>
            <FontAwesomeIcon icon={faArrowRight} className="prf-vibe__go" />
          </button>
        </li>
      ))}
    </ul>
  );
};

export default ProfileVibeProjects;
