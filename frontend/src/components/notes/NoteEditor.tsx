import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBold, faItalic, faHeading, faListUl, faListCheck, faLink, faCode, faQuoteRight, faHighlighter,
  faStrikethrough, faTable, faMinus,
} from '@fortawesome/free-solid-svg-icons';
import type { NoteMeta } from '../../utils/api';
import { renderMarkdown } from './markdown';
import { caretCoordinates } from './caret';
import { fuzzyScore, notePath, toggleTask } from './noteLinks';

export type EditorMode = 'edit' | 'preview' | 'split';

interface Props {
  note: NoteMeta;
  content: string;
  notes: NoteMeta[];
  mode: EditorMode;
  scrollToHeading: { slug: string; line?: number; nonce: number } | null;
  onChange: (content: string) => void;
  onOpenLink: (target: string, heading?: string) => void;
  onTag: (tag: string) => void;
}

interface Suggest {
  start: number; // «[[» кейінгі позиция
  query: string;
  top: number;
  left: number;
  index: number;
}

/** Textarea-ға мәтін енгізу — браузердің «болдырмау» (Ctrl+Z) тарихы сақталады */
function replaceRange(el: HTMLTextAreaElement, start: number, end: number, text: string, selStart?: number, selEnd?: number) {
  el.focus();
  el.setSelectionRange(start, end);
  const ok = document.execCommand?.('insertText', false, text);
  if (!ok) {
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (selStart !== undefined) el.setSelectionRange(selStart, selEnd ?? selStart);
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/;

const NoteEditor: React.FC<Props> = ({ note, content, notes, mode, scrollToHeading, onChange, onOpenLink, onTag }) => {
  const { t } = useTranslation();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [suggest, setSuggest] = useState<Suggest | null>(null);
  const syncing = useRef(false);

  const html = useMemo(() => (mode === 'edit' ? '' : renderMarkdown(content, notes)), [content, notes, mode]);

  const candidates = useMemo(() => {
    if (!suggest) return [];
    return notes
      .filter((n) => n.id !== note.id)
      .map((n) => ({ n, score: Math.max(fuzzyScore(suggest.query, n.title), fuzzyScore(suggest.query, notePath(n)) - 1) }))
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.n);
  }, [notes, note.id, suggest]);

  // Мазмұннан тақырыпқа өту
  useEffect(() => {
    if (!scrollToHeading) return;
    const target = previewRef.current?.querySelector<HTMLElement>(`#nt-h-${CSS.escape(scrollToHeading.slug)}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const el = textRef.current;
    if (!el || scrollToHeading.line === undefined) return;
    const pos = content.split('\n').slice(0, scrollToHeading.line).join('\n').length + (scrollToHeading.line ? 1 : 0);
    el.focus();
    el.setSelectionRange(pos, pos);
    el.scrollTop = Math.max(0, caretCoordinates(el, pos).top + el.scrollTop - 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToHeading]);

  const updateSuggest = useCallback(() => {
    const el = textRef.current;
    if (!el || el.selectionStart !== el.selectionEnd) {
      setSuggest(null);
      return;
    }
    const before = el.value.slice(0, el.selectionStart);
    const m = /\[\[([^[\]|#\n]*)$/.exec(before);
    if (!m) {
      setSuggest(null);
      return;
    }
    const coords = caretCoordinates(el, el.selectionStart);
    setSuggest((prev) => ({
      start: el.selectionStart - m[1].length,
      query: m[1],
      top: coords.top + coords.height + 4,
      left: Math.min(coords.left, el.clientWidth - 260),
      index: prev && prev.start === el.selectionStart - m[1].length ? prev.index : 0,
    }));
  }, []);

  const acceptSuggest = (target: NoteMeta) => {
    const el = textRef.current;
    if (!el || !suggest) return;
    const after = el.value.slice(el.selectionStart);
    const closing = after.startsWith(']]') ? 2 : 0;
    const title = notes.filter((n) => n.title.toLowerCase() === target.title.toLowerCase()).length > 1 ? notePath(target) : target.title;
    const insert = `${title}]]`;
    replaceRange(el, suggest.start, el.selectionStart + closing, insert, suggest.start + insert.length);
    setSuggest(null);
  };

  /** Белгіленген мәтінді орау: **жуан**, *көлбеу* т.б. */
  const wrap = (before: string, after = before, placeholder = '') => {
    const el = textRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const selected = value.slice(s, e) || placeholder;
    if (value.slice(s - before.length, s) === before && value.slice(e, e + after.length) === after) {
      replaceRange(el, s - before.length, e + after.length, selected, s - before.length, s - before.length + selected.length);
      return;
    }
    replaceRange(el, s, e, before + selected + after, s + before.length, s + before.length + selected.length);
  };

  /** Белгіленген жолдардың басына префикс қосу/алу: «# », «- », «> » */
  const linePrefix = (prefix: string, pattern: RegExp) => {
    const el = textRef.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const lineEndIdx = value.indexOf('\n', e);
    const lineEnd = lineEndIdx < 0 ? value.length : lineEndIdx;
    const lines = value.slice(lineStart, lineEnd).split('\n');
    const allHave = lines.every((l) => pattern.test(l));
    const next = lines.map((l) => (allHave ? l.replace(pattern, '') : prefix + l.replace(pattern, ''))).join('\n');
    replaceRange(el, lineStart, lineEnd, next, lineStart, lineStart + next.length);
  };

  const insertBlock = (text: string) => {
    const el = textRef.current;
    if (!el) return;
    const s = el.selectionStart;
    const needsNl = s > 0 && el.value[s - 1] !== '\n';
    const insert = (needsNl ? '\n' : '') + text;
    replaceRange(el, s, el.selectionEnd, insert, s + insert.length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (suggest && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + delta + candidates.length) % candidates.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptSuggest(candidates[suggest.index] ?? candidates[0]);
        return;
      }
    }
    if (suggest && e.key === 'Escape') {
      e.preventDefault();
      setSuggest(null);
      return;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); wrap('**', '**', t('notes.fmt.bold')); return; }
      if (k === 'i') { e.preventDefault(); wrap('*', '*', t('notes.fmt.italic')); return; }
      if (k === 'k') { e.preventDefault(); wrap('[[', ']]'); updateSuggest(); return; }
    }

    // «[[» — жабылатын «]]» автоматты түрде қосылады
    if (e.key === '[' && !mod && el.value[el.selectionStart - 1] === '[' && el.selectionStart === el.selectionEnd) {
      e.preventDefault();
      const s = el.selectionStart;
      replaceRange(el, s, s, '[]]', s + 1);
      setTimeout(updateSuggest, 0);
      return;
    }

    // Автоматты қосылған «]» үстінен өту — қолмен терілген «]]» екі еселенбейді
    if (e.key === ']' && !mod && el.selectionStart === el.selectionEnd && el.value[el.selectionStart] === ']') {
      e.preventDefault();
      el.setSelectionRange(el.selectionStart + 1, el.selectionStart + 1);
      setSuggest(null);
      return;
    }

    // Тізімдерде Tab / Shift+Tab — шегіндіру
    if (e.key === 'Tab' && !mod) {
      const { selectionStart: s, value } = el;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, value.indexOf('\n', s) < 0 ? value.length : value.indexOf('\n', s));
      if (LIST_RE.test(line) || e.shiftKey) {
        e.preventDefault();
        if (e.shiftKey) {
          const remove = /^( {1,2}|\t)/.exec(line)?.[0].length ?? 0;
          if (remove) replaceRange(el, lineStart, lineStart + remove, '', Math.max(lineStart, s - remove));
        } else {
          replaceRange(el, lineStart, lineStart, '  ', s + 2);
        }
        return;
      }
      e.preventDefault();
      replaceRange(el, s, el.selectionEnd, '  ', s + 2);
      return;
    }

    // Enter — тізімді жалғастыру; бос тармақта — тізімнен шығу
    if (e.key === 'Enter' && !e.shiftKey && !mod) {
      const { selectionStart: s, value } = el;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const line = value.slice(lineStart, s);
      const m = LIST_RE.exec(line);
      if (!m) return;
      e.preventDefault();
      if (line.trim() === m[0].trim()) {
        replaceRange(el, lineStart, s, '', lineStart);
        return;
      }
      const num = /^\d+/.exec(m[2]);
      const bullet = num ? `${Number(num[0]) + 1}${m[2].slice(num[0].length)}` : m[2];
      const insert = `\n${m[1]}${bullet}${m[3] ? ' [ ]' : ''} `;
      replaceRange(el, s, el.selectionEnd, insert, s + insert.length);
    }
  };

  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains('nt-task')) {
      e.preventDefault();
      const boxes = [...(previewRef.current?.querySelectorAll('input.nt-task') ?? [])];
      onChange(toggleTask(content, boxes.indexOf(target)));
      return;
    }
    const link = target.closest('a');
    if (!link) return;
    if (link.classList.contains('nt-wikilink')) {
      e.preventDefault();
      onOpenLink(link.dataset.target || '', link.dataset.heading);
    } else if (link.classList.contains('nt-tag')) {
      e.preventDefault();
      onTag(link.dataset.tag || '');
    } else if (link.getAttribute('href')?.startsWith('#')) {
      e.preventDefault();
    }
  };

  // Қатар режимінде прокруттау синхроны
  const syncScroll = (from: HTMLElement | null, to: HTMLElement | null) => {
    if (!from || !to || mode !== 'split') return;
    if (syncing.current) {
      syncing.current = false;
      return;
    }
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    syncing.current = true;
    to.scrollTop = ratio * (to.scrollHeight - to.clientHeight);
  };

  const tools: [typeof faBold, string, () => void][] = [
    [faHeading, t('notes.fmt.heading'), () => linePrefix('## ', /^#{1,6}\s+/)],
    [faBold, `${t('notes.fmt.bold')} (Ctrl+B)`, () => wrap('**', '**', t('notes.fmt.bold'))],
    [faItalic, `${t('notes.fmt.italic')} (Ctrl+I)`, () => wrap('*', '*', t('notes.fmt.italic'))],
    [faStrikethrough, t('notes.fmt.strike'), () => wrap('~~')],
    [faHighlighter, t('notes.fmt.highlight'), () => wrap('==')],
    [faListUl, t('notes.fmt.list'), () => linePrefix('- ', /^\s*[-*+]\s+(?!\[)/)],
    [faListCheck, t('notes.fmt.task'), () => linePrefix('- [ ] ', /^\s*[-*+]\s+\[[ xX]\]\s+/)],
    [faQuoteRight, t('notes.fmt.quote'), () => linePrefix('> ', /^>\s?/)],
    [faLink, `${t('notes.fmt.link')} (Ctrl+K)`, () => { wrap('[[', ']]'); updateSuggest(); }],
    [faCode, t('notes.fmt.code'), () => wrap('`')],
    [faTable, t('notes.fmt.table'), () => insertBlock('| A | B |\n| --- | --- |\n|  |  |\n')],
    [faMinus, t('notes.fmt.divider'), () => insertBlock('\n---\n')],
  ];

  const words = useMemo(() => (content.match(/[\p{L}\p{N}]+/gu) ?? []).length, [content]);

  return (
    <div className={`nt-editor nt-editor--${mode}`}>
      {mode !== 'preview' && (
        <div className="nt-editor__toolbar">
          {tools.map(([icon, label, run]) => (
            <button key={label} type="button" className="nt-icon-btn nt-icon-btn--sm" title={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
              <FontAwesomeIcon icon={icon} />
            </button>
          ))}
          <span className="nt-editor__count">{t('notes.wordCount', { count: words })} · {t('notes.charCount', { count: content.length })}</span>
        </div>
      )}
      <div className="nt-editor__body">
        {mode !== 'preview' && (
          <div className="nt-editor__pane nt-editor__pane--source">
            <textarea
              ref={textRef}
              className="nt-editor__textarea"
              value={content}
              spellCheck
              placeholder={t('notes.editorPlaceholder')}
              onChange={(e) => {
                onChange(e.target.value);
                requestAnimationFrame(updateSuggest);
              }}
              onKeyDown={onKeyDown}
              onClick={updateSuggest}
              onBlur={() => setTimeout(() => setSuggest(null), 150)}
              onScroll={(e) => {
                setSuggest(null);
                syncScroll(e.currentTarget, previewRef.current);
              }}
            />
            {suggest && (
              <div className="nt-suggest" style={{ top: suggest.top, left: Math.max(8, suggest.left) }}>
                {candidates.map((n, i) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`nt-suggest__item${i === suggest.index ? ' is-active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      acceptSuggest(n);
                    }}
                  >
                    <span>{n.title}</span>
                    {n.folder && <small>{n.folder}</small>}
                  </button>
                ))}
                {!candidates.length && (
                  <div className="nt-suggest__empty">
                    {suggest.query ? t('notes.linkWillCreate', { name: suggest.query }) : t('notes.typeToSearch')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {mode !== 'edit' && (
          <div
            ref={previewRef}
            className="nt-editor__pane nt-editor__pane--preview"
            onScroll={(e) => syncScroll(e.currentTarget, textRef.current)}
          >
            <article className="nt-markdown" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
            {!content.trim() && <p className="nt-sidebar__empty">{t('notes.emptyNote')}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default NoteEditor;
