import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiService, SharedProjectDTO } from '../utils/api';
import { FileTypeIcon } from '../components/vibecoding/fileIcons';
import './SharedProjectPage.css';

/* Сілтеме арқылы бөлісілген Vibecoding жобасы (/vibecoding/shared/<токен>): файлдарын қарап,
   бір батырмамен көшірмесін өзіне алып, Vibecoding-те ашуға болады. */

const SharedProjectPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<SharedProjectDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [forking, setForking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiService.getSharedProject(token)
      .then((data) => {
        if (cancelled) return;
        setProject(data);
        const readme = data.files.find((f) => /^readme(\.md)?$/i.test(f.path));
        setActivePath((readme ?? data.files[0])?.path ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Жоба ашылмады'));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const files = useMemo(
    () => [...(project?.files ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
    [project]
  );
  const active = files.find((f) => f.path === activePath);

  const fork = async () => {
    if (!project) return;
    if (project.isOwner && project.projectId) {
      navigate(`/vibecoding?project=${encodeURIComponent(project.projectId)}`);
      return;
    }
    setForking(true);
    setError(null);
    try {
      const copy = await apiService.forkProjectByLink(token, `${project.name} (көшірме)`);
      navigate(`/vibecoding?project=${encodeURIComponent(copy.id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Көшіру мүмкін болмады');
      setForking(false);
    }
  };

  if (error && !project) {
    return (
      <div className="shp shp--empty">
        <h1>Жоба ашылмады</h1>
        <p>{error}</p>
        <Link to="/" className="shp__btn">Басты бетке</Link>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="shp shp--empty">
        <span className="shp__spinner" aria-label="Жүктелуде" />
      </div>
    );
  }

  return (
    <div className="shp">
      <header className="shp__head">
        <div className="shp__title">
          <h1>{project.name}</h1>
          <p>
            {project.owner ? <Link to={`/profile/${project.owner}`}>@{project.owner}</Link> : 'Белгісіз автор'}
            {' · '}
            {files.length} файл
            {project.updatedAt && ` · ${new Date(project.updatedAt).toLocaleDateString()}`}
          </p>
        </div>
        <button type="button" className="shp__btn is-primary" onClick={fork} disabled={forking}>
          {project.isOwner ? 'Vibecoding-те ашу' : forking ? 'Көшірілуде…' : 'Көшірмесін алу'}
        </button>
      </header>
      {error && <p className="shp__error">{error}</p>}

      <div className="shp__body">
        <nav className="shp__files" aria-label="Файлдар">
          {files.length === 0 && <p className="shp__muted">Жоба бос</p>}
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className={`shp__file ${f.path === activePath ? 'is-active' : ''}`}
              onClick={() => setActivePath(f.path)}
              title={f.path}
            >
              <FileTypeIcon name={f.path} size={14} />
              <span>{f.path}</span>
            </button>
          ))}
        </nav>
        <section className="shp__view">
          {active ? (
            <>
              <div className="shp__view-bar">{active.path}</div>
              <pre className="shp__code"><code>{active.content}</code></pre>
            </>
          ) : (
            <p className="shp__muted">Файлды таңдаңыз</p>
          )}
        </section>
      </div>
    </div>
  );
};

export default SharedProjectPage;
