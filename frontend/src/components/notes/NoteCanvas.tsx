import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFont, faFileLines, faGlobe, faExpand, faTrash, faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
import type { NoteMeta } from '../../utils/api';
import { renderMarkdown } from './markdown';
import { notePath, resolveLink } from './noteLinks';

/*
 * Canvas — Obsidian Canvas сияқты шексіз тақта.
 * JSON: { nodes: [{id, type: text|note|link, x, y, w, h, text?, note?, url?, color?}], edges: [{id, from, to, label?}] }
 */

export interface CanvasNode {
  id: string;
  type: 'text' | 'note' | 'link';
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  note?: string;
  url?: string;
  color?: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

interface Props {
  content: string;
  notes: NoteMeta[];
  contents: Record<string, string>;
  loadContent: (id: string) => Promise<string | undefined>;
  onChange: (content: string) => void;
  onOpen: (id: string) => void;
  onOpenLink: (target: string) => void;
  onPickNote: (onPicked: (note: NoteMeta) => void) => void;
}

const COLORS = ['', 'red', 'orange', 'yellow', 'green', 'cyan', 'purple'];
const uid = () => Math.random().toString(36).slice(2, 10);

function parse(content: string): CanvasData {
  try {
    const data = JSON.parse(content || '{}');
    return {
      nodes: Array.isArray(data.nodes) ? data.nodes.filter((n: CanvasNode) => n && n.id) : [],
      edges: Array.isArray(data.edges) ? data.edges.filter((e: CanvasEdge) => e && e.from && e.to) : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

/** Екі карточканың шекараларындағы ең жақын нүктелер — көрсеткі сол жерден басталады */
function anchor(a: CanvasNode, b: CanvasNode) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const edgePoint = (n: CanvasNode, c: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - c.x;
    const dy = to.y - c.y;
    if (!dx && !dy) return c;
    const sx = dx ? n.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy ? n.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    return { x: c.x + dx * s, y: c.y + dy * s };
  };
  return { from: edgePoint(a, ac, bc), to: edgePoint(b, bc, ac) };
}

const NoteCanvas: React.FC<Props> = ({ content, notes, contents, loadContent, onChange, onOpen, onOpenLink, onPickNote }) => {
  const { t } = useTranslation();
  const [data, setData] = useState<CanvasData>(() => parse(content));
  const [view, setView] = useState({ x: 80, y: 60, k: 1 });
  const [selected, setSelected] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<{ from: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const lastEmitted = useRef(content);

  // Сырттан өзгерсе (мысалы, атауы өзгерген жазба) — қайта оқу
  useEffect(() => {
    if (content !== lastEmitted.current) {
      lastEmitted.current = content;
      setData(parse(content));
    }
  }, [content]);

  const commit = useCallback((next: CanvasData) => {
    dataRef.current = next;
    setData(next);
    const json = JSON.stringify(next);
    lastEmitted.current = json;
    onChange(json);
  }, [onChange]);

  const updateNode = (id: string, patch: Partial<CanvasNode>, save = true) => {
    const next = { ...dataRef.current, nodes: dataRef.current.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
    dataRef.current = next;
    if (save) commit(next);
    else setData(next);
  };

  // Жазба карточкаларының мәтінін жүктеу
  const noteIds = useMemo(
    () => data.nodes.filter((n) => n.type === 'note').map((n) => resolveLink(n.note || '', notes)?.id).filter(Boolean) as string[],
    [data.nodes, notes]
  );
  useEffect(() => {
    noteIds.forEach((id) => contents[id] === undefined && loadContent(id));
  }, [noteIds, contents, loadContent]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k };
  };

  const centerPoint = () => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const addNode = (node: Omit<CanvasNode, 'id' | 'x' | 'y'> & { x?: number; y?: number }) => {
    const c = centerPoint();
    const created: CanvasNode = { id: uid(), x: (node.x ?? c.x) - node.w / 2, y: (node.y ?? c.y) - node.h / 2, ...node } as CanvasNode;
    created.x = Math.round(created.x);
    created.y = Math.round(created.y);
    commit({ ...dataRef.current, nodes: [...dataRef.current.nodes, created] });
    setSelected({ kind: 'node', id: created.id });
    return created;
  };

  const removeSelected = () => {
    if (!selected) return;
    const cur = dataRef.current;
    if (selected.kind === 'node') {
      commit({
        nodes: cur.nodes.filter((n) => n.id !== selected.id),
        edges: cur.edges.filter((e) => e.from !== selected.id && e.to !== selected.id),
      });
    } else {
      commit({ ...cur, edges: cur.edges.filter((e) => e.id !== selected.id) });
    }
    setSelected(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId || !selected) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeSelected();
      }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const fit = () => {
    const nodes = dataRef.current.nodes;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!nodes.length) {
      setView({ x: rect.width / 2, y: rect.height / 2, k: 1 });
      return;
    }
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.w));
    const maxY = Math.max(...nodes.map((n) => n.y + n.h));
    const k = Math.min(1.5, Math.max(0.2, Math.min((rect.width - 80) / (maxX - minX), (rect.height - 80) / (maxY - minY))));
    setView({ k, x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k });
  };

  // Фонды сүйреп жылжыту
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('nt-canvas__world')) return;
    setSelected(null);
    setEditingId(null);
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: start.vx + ev.clientX - start.x, y: start.vy + ev.clientY - start.y }));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.nt-canvas__card-body--scroll') && !e.ctrlKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setView((v) => {
        const k = Math.min(3, Math.max(0.15, v.k * Math.exp(-e.deltaY * 0.0015)));
        return { k, x: sx - ((sx - v.x) / v.k) * k, y: sy - ((sy - v.y) / v.k) * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** Карточканы сүйреу немесе өлшемін өзгерту */
  const startDrag = (e: React.PointerEvent, node: CanvasNode, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setSelected({ kind: 'node', id: node.id });
    const start = { x: e.clientX, y: e.clientY, nx: node.x, ny: node.y, w: node.w, h: node.h };
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / view.k;
      const dy = (ev.clientY - start.y) / view.k;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (mode === 'move') updateNode(node.id, { x: Math.round(start.nx + dx), y: Math.round(start.ny + dy) }, false);
      else updateNode(node.id, { w: Math.max(140, Math.round(start.w + dx)), h: Math.max(60, Math.round(start.h + dy)) }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) commit(dataRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Карточканың шетіндегі нүктеден көрсеткі тарту */
  const startConnect = (e: React.PointerEvent, node: CanvasNode) => {
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    setConnecting({ from: node.id, ...p });
    const move = (ev: PointerEvent) => setConnecting((c) => (c ? { ...c, ...toWorld(ev.clientX, ev.clientY) } : c));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setConnecting(null);
      const q = toWorld(ev.clientX, ev.clientY);
      const target = dataRef.current.nodes.find((n) => n.id !== node.id && q.x >= n.x && q.x <= n.x + n.w && q.y >= n.y && q.y <= n.y + n.h);
      const cur = dataRef.current;
      if (target && !cur.edges.some((ed) => ed.from === node.id && ed.to === target.id)) {
        commit({ ...cur, edges: [...cur.edges, { id: uid(), from: node.id, to: target.id }] });
      } else if (!target) {
        // Бос жерге тартылса — сол жерде жаңа мәтін карточкасы
        const created: CanvasNode = { id: uid(), type: 'text', x: Math.round(q.x - 120), y: Math.round(q.y - 40), w: 240, h: 100, text: '' };
        commit({ nodes: [...cur.nodes, created], edges: [...cur.edges, { id: uid(), from: node.id, to: created.id }] });
        setEditingId(created.id);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).classList.contains('nt-canvas__world')) return;
    const p = toWorld(e.clientX, e.clientY);
    const created = addNode({ type: 'text', w: 240, h: 100, text: '', x: p.x, y: p.y });
    setEditingId(created.id);
  };

  // Сайдбардан жазбаны тақтаға сүйреп әкелу
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData('application/x-note-id');
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    addNode({ type: 'note', note: notePath(note), w: 320, h: 240, x: p.x, y: p.y });
  };

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const selectedNode = selected?.kind === 'node' ? byId.get(selected.id) : undefined;
  const selectedEdge = selected?.kind === 'edge' ? data.edges.find((e) => e.id === selected.id) : undefined;

  const renderBody = (node: CanvasNode) => {
    if (node.type === 'text') {
      if (editingId === node.id) {
        return (
          <textarea
            className="nt-canvas__textarea"
            autoFocus
            defaultValue={node.text}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setEditingId(null);
              if (e.target.value !== node.text) updateNode(node.id, { text: e.target.value });
            }}
            onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLTextAreaElement).blur()}
          />
        );
      }
      return node.text?.trim() ? (
        <div
          className="nt-markdown nt-canvas__card-body--scroll"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(node.text, notes) }}
          onClick={(e) => {
            const link = (e.target as HTMLElement).closest('a.nt-wikilink') as HTMLAnchorElement | null;
            if (link) { e.preventDefault(); onOpenLink(link.dataset.target || ''); }
          }}
        />
      ) : (
        <p className="nt-canvas__hint">{t('notes.canvas.editHint')}</p>
      );
    }
    if (node.type === 'note') {
      const target = resolveLink(node.note || '', notes);
      const text = target ? contents[target.id] : undefined;
      return (
        <>
          <button type="button" className="nt-canvas__note-title" onPointerDown={(e) => e.stopPropagation()} onClick={() => (target ? onOpen(target.id) : onOpenLink(node.note || ''))}>
            <FontAwesomeIcon icon={faFileLines} /> {target?.title ?? node.note}
            {!target && <small> · {t('notes.info.missing')}</small>}
          </button>
          {target && (
            <div
              className="nt-markdown nt-canvas__card-body--scroll"
              dangerouslySetInnerHTML={{ __html: text === undefined ? '…' : renderMarkdown(text, notes) }}
            />
          )}
        </>
      );
    }
    const safe = /^https?:\/\//i.test(node.url || '') ? node.url! : `https://${node.url}`;
    return (
      <a className="nt-canvas__link" href={safe} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>
        <FontAwesomeIcon icon={faGlobe} /> {node.url}
      </a>
    );
  };

  const [linkInput, setLinkInput] = useState<string | null>(null);

  return (
    <div className="nt-canvas">
      <div className="nt-canvas__toolbar">
        <button type="button" className="nt-icon-btn" title={t('notes.canvas.addText')} onClick={() => setEditingId(addNode({ type: 'text', w: 240, h: 100, text: '' }).id)}>
          <FontAwesomeIcon icon={faFont} />
        </button>
        <button
          type="button"
          className="nt-icon-btn"
          title={t('notes.canvas.addNote')}
          onClick={() => onPickNote((note) => addNode({ type: 'note', note: notePath(note), w: 320, h: 240 }))}
        >
          <FontAwesomeIcon icon={faFileLines} />
        </button>
        <button type="button" className="nt-icon-btn" title={t('notes.canvas.addLink')} onClick={() => setLinkInput('')}>
          <FontAwesomeIcon icon={faGlobe} />
        </button>
        <span className="nt-canvas__sep" />
        <button type="button" className="nt-icon-btn" title={t('notes.canvas.fit')} onClick={fit}>
          <FontAwesomeIcon icon={faExpand} />
        </button>
        <button type="button" className="nt-icon-btn" title={t('notes.canvas.resetZoom')} onClick={() => setView((v) => ({ ...v, k: 1 }))}>
          <FontAwesomeIcon icon={faArrowsRotate} />
        </button>
        <span className="nt-canvas__zoom">{Math.round(view.k * 100)}%</span>
        {(selectedNode || selectedEdge) && (
          <>
            <span className="nt-canvas__sep" />
            {selectedNode &&
              COLORS.map((c) => (
                <button
                  key={c || 'none'}
                  type="button"
                  className={`nt-canvas__swatch nt-color--${c || 'none'}${(selectedNode.color || '') === c ? ' is-active' : ''}`}
                  onClick={() => updateNode(selectedNode.id, { color: c || undefined })}
                  aria-label={c || t('notes.canvas.noColor')}
                />
              ))}
            {selectedEdge && (
              <input
                className="nt-input nt-input--sm"
                placeholder={t('notes.canvas.edgeLabel')}
                defaultValue={selectedEdge.label}
                key={selectedEdge.id}
                onBlur={(e) => commit({ ...dataRef.current, edges: dataRef.current.edges.map((ed) => (ed.id === selectedEdge.id ? { ...ed, label: e.target.value || undefined } : ed)) })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            )}
            <button type="button" className="nt-icon-btn is-danger" title={t('notes.delete')} onClick={removeSelected}>
              <FontAwesomeIcon icon={faTrash} />
            </button>
          </>
        )}
        {linkInput !== null && (
          <input
            className="nt-input nt-input--sm"
            autoFocus
            placeholder="https://…"
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onBlur={() => setLinkInput(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && linkInput.trim()) {
                addNode({ type: 'link', url: linkInput.trim(), w: 280, h: 70 });
                setLinkInput(null);
              }
              if (e.key === 'Escape') setLinkInput(null);
            }}
          />
        )}
      </div>

      <div
        ref={wrapRef}
        className="nt-canvas__viewport"
        style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}
        onPointerDown={onBackgroundDown}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => e.dataTransfer.types.includes('application/x-note-id') && e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="nt-canvas__world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="nt-canvas__edges">
            <defs>
              <marker id="nt-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="nt-canvas__arrow" />
              </marker>
            </defs>
            {data.edges.map((edge) => {
              const a = byId.get(edge.from);
              const b = byId.get(edge.to);
              if (!a || !b) return null;
              const { from, to } = anchor(a, b);
              const isSel = selected?.kind === 'edge' && selected.id === edge.id;
              return (
                <g key={edge.id} className={`nt-canvas__edge${isSel ? ' is-selected' : ''}`}>
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="nt-canvas__edge-hit" onPointerDown={(e) => { e.stopPropagation(); setSelected({ kind: 'edge', id: edge.id }); }} />
                  <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="nt-canvas__edge-line" markerEnd="url(#nt-arrow)" />
                  {edge.label && (
                    <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 6} className="nt-canvas__edge-label" textAnchor="middle">
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}
            {connecting && byId.get(connecting.from) && (() => {
              const a = byId.get(connecting.from)!;
              return <line x1={a.x + a.w} y1={a.y + a.h / 2} x2={connecting.x} y2={connecting.y} className="nt-canvas__edge-line is-draft" markerEnd="url(#nt-arrow)" />;
            })()}
          </svg>

          {data.nodes.map((node) => (
            <div
              key={node.id}
              className={`nt-canvas__card nt-canvas__card--${node.type} nt-color--${node.color || 'none'}${selected?.kind === 'node' && selected.id === node.id ? ' is-selected' : ''}`}
              style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
              onPointerDown={(e) => startDrag(e, node, 'move')}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (node.type === 'text') setEditingId(node.id);
                if (node.type === 'note') {
                  const target = resolveLink(node.note || '', notes);
                  if (target) onOpen(target.id);
                }
              }}
            >
              <div className="nt-canvas__card-inner">{renderBody(node)}</div>
              <span className="nt-canvas__connector" onPointerDown={(e) => startConnect(e, node)} title={t('notes.canvas.connect')} />
              <span className="nt-canvas__resize" onPointerDown={(e) => startDrag(e, node, 'resize')} />
            </div>
          ))}
        </div>
        {!data.nodes.length && <div className="nt-canvas__empty">{t('notes.canvas.empty')}</div>}
      </div>
    </div>
  );
};

export default NoteCanvas;
