import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useVibecoding } from '../../contexts/VibecodingContext';
import { requestReveal } from '../../utils/vibeBridge';
import { ArrowLeftIcon, ChevronDownIcon, CloseIcon, SearchIcon } from './icons';
import { FileTypeIcon } from './fileIcons';

/** Бір файлда көрсетілетін ең көп сәйкестік және жалпы шек — үлкен жобада бет қатып қалмауы үшін */
const PER_FILE_LIMIT = 50;
const TOTAL_LIMIT = 1000;

interface LineHit {
  line: number;
  column: number;
  text: string;
  start: number;
  end: number;
}

interface FileHit {
  id: string;
  name: string;
  path: string;
  nameMatch: boolean;
  lines: LineHit[];
  more: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Сәйкес бөлікті ерекшелеп көрсету */
function Mark({ text, start, end }: { text: string; start: number; end: number }) {
  // Ұзын жолдарда сәйкестіктің алдынан тым көп мәтін көрсетпейміз
  const cut = start > 40 ? start - 30 : 0;
  return (
    <>
      {cut > 0 && '…'}
      {text.slice(cut, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/** Сайтбардағы іздеу: файл аты мен ішіндегі мәтін бойынша (VS Code-тың Search панелі сияқты) */
const SearchPanel: React.FC<{ isOverlay?: boolean; active?: boolean }> = ({ isOverlay, active }) => {
  const { t } = useTranslation();
  const { dispatch, activeProject } = useVibecoding();
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  // Бөлім ашылғанда — бірден теруге болады
  useEffect(() => {
    if (active) requestAnimationFrame(() => inputRef.current?.select());
  }, [active]);

  const files = activeProject?.files;

  const { results } = useMemo(() => {
    const q = query.trim();
    if (!q || !files) return { results: [] as FileHit[], total: 0, capped: false };
    const src = wholeWord ? `\\b${escapeRegExp(q)}\\b` : escapeRegExp(q);
    const re = new RegExp(src, caseSensitive ? 'g' : 'gi');
    const nameRe = new RegExp(src, caseSensitive ? '' : 'i');
    const out: FileHit[] = [];
    let count = 0;
    let isCapped = false;
    for (const f of files) {
      if (count >= TOTAL_LIMIT) { isCapped = true; break; }
      const nameMatch = nameRe.test(f.path);
      const lines: LineHit[] = [];
      let more = 0;
      const content = f.content || '';
      if (content && content.length < 2_000_000) {
        const rows = content.split('\n');
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(row))) {
            if (m[0].length === 0) { re.lastIndex++; continue; }
            if (lines.length >= PER_FILE_LIMIT || count >= TOTAL_LIMIT) { more++; continue; }
            lines.push({ line: i + 1, column: m.index + 1, text: row.slice(0, 300), start: m.index, end: m.index + m[0].length });
            count++;
          }
        }
      }
      if (nameMatch || lines.length) {
        out.push({ id: f.id, name: f.name, path: f.path, nameMatch, lines, more });
      }
    }
    // Аты сәйкес файлдар жоғарыда
    out.sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch));
    return { results: out, total: count, capped: isCapped };
  }, [query, files, caseSensitive, wholeWord]);

  const open = (path: string, line?: number, column?: number) => {
    if (!activeProject) return;
    if (line) requestReveal({ path, line, column: column ?? 1 });
    dispatch({ type: 'OPEN_PROJECT_FILE', payload: { projectId: activeProject.id, path } });
    if (isOverlay) dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false });
  };

  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault();
      setQuery('');
    } else if (e.key === 'Enter' && results[0]) {
      e.preventDefault();
      const first = results[0];
      open(first.path, first.lines[0]?.line, first.lines[0]?.column);
    }
  };

  const q = query.trim();

  return (
    <div className="vx-explorer vx-search select-none">
      <div className="vx-explorer__head">
        {isOverlay && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'SET_LEFT_PANEL_VISIBLE', payload: false })}
            className="vx-icon-btn vx-icon-btn--sm"
            title={t('vibecoding.search.close', 'Жабу')}
          >
            <ArrowLeftIcon size={17} />
          </button>
        )}
        <span className="vx-explorer__title">{t('vibecoding.search.title', 'Іздеу')}</span>
        {(q || collapsed.size > 0) && (
          <div className="vx-explorer__actions">
            <button
              type="button"
              className="vx-icon-btn vx-icon-btn--sm"
              onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(results.map(r => r.id)))}
              title={collapsed.size ? t('vibecoding.search.expandAll', 'Бәрін ашу') : t('vibecoding.search.collapseAll', 'Бәрін жию')}
            >
              <ChevronDownIcon size={15} />
            </button>
          </div>
        )}
      </div>

      <div className="vx-search__box">
        <SearchIcon size={14} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('vibecoding.search.title', 'Іздеу')}
          aria-label={t('vibecoding.search.title', 'Іздеу')}
          spellCheck={false}
          className="vx-search__input"
        />
        {query && (
          <button
            type="button"
            className="vx-search__opt"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }}
            title={t('vibecoding.search.clear', 'Тазалау')}
            aria-label={t('vibecoding.search.clear', 'Тазалау')}
          >
            <CloseIcon size={12} />
          </button>
        )}
        <button
          type="button"
          className={`vx-search__opt ${caseSensitive ? 'is-on' : ''}`}
          onClick={() => setCaseSensitive(v => !v)}
          aria-pressed={caseSensitive}
          title={t('vibecoding.search.matchCase', 'Регистрді ескеру')}
        >
          Aa
        </button>
        <button
          type="button"
          className={`vx-search__opt ${wholeWord ? 'is-on' : ''}`}
          onClick={() => setWholeWord(v => !v)}
          aria-pressed={wholeWord}
          title={t('vibecoding.search.wholeWord', 'Тұтас сөз')}
        >
          <u>ab</u>
        </button>
      </div>

      {q && results.length === 0 && (
        <div className="vx-search__summary" aria-live="polite">
          {t('vibecoding.search.noResults', 'Ештеңе табылмады')}
        </div>
      )}

      <div className="vx-search__results" role="tree">
        {results.map(r => {
          const isCollapsed = collapsed.has(r.id);
          return (
            <div key={r.id} className="vx-search__file" role="treeitem" aria-expanded={!isCollapsed}>
              <div className="vx-search__file-row">
                <button
                  type="button"
                  className={`vx-search__chev ${isCollapsed ? 'is-collapsed' : ''}`}
                  onClick={() => toggle(r.id)}
                  aria-label={isCollapsed ? t('vibecoding.search.expand', 'Ашу') : t('vibecoding.search.collapse', 'Жию')}
                  disabled={r.lines.length === 0}
                >
                  <ChevronDownIcon size={13} />
                </button>
                <button type="button" className="vx-search__file-btn" onClick={() => open(r.path)} title={r.path}>
                  <FileTypeIcon name={r.name} size={15} />
                  <span className="vx-search__name">{r.name}</span>
                </button>
                {r.lines.length > 0 && <span className="vx-search__count">{r.lines.length + r.more}</span>}
              </div>
              {!isCollapsed && r.lines.map((h, i) => (
                <button
                  key={`${h.line}:${h.column}:${i}`}
                  type="button"
                  className="vx-search__hit"
                  onClick={() => open(r.path, h.line, h.column)}
                  title={`${r.path}:${h.line}`}
                >
                  <span className="vx-search__ln">{h.line}</span>
                  <span className="vx-search__text"><Mark text={h.text} start={h.start} end={h.end} /></span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SearchPanel;
