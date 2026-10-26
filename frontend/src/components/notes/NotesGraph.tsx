import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NoteMeta } from '../../utils/api';
import { resolveLink } from './noteLinks';

interface Props {
  notes: NoteMeta[];
  activeId: string | null;
  /** Жергілікті граф: тек ашық жазба және оның көршілері */
  local?: boolean;
  onOpen: (id: string) => void;
  onOpenLink: (target: string) => void;
  onTag: (tag: string) => void;
}

type NodeKind = 'note' | 'missing' | 'tag';

interface GNode {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  degree: number;
  fixed?: boolean;
}

interface GEdge {
  a: GNode;
  b: GNode;
}

interface Settings {
  showTags: boolean;
  showMissing: boolean;
  showOrphans: boolean;
  depth: number;
  filter: string;
}

const cssVar = (el: Element, name: string, fallback: string) =>
  getComputedStyle(el).getPropertyValue(name).trim() || fallback;

function buildGraph(notes: NoteMeta[], settings: Settings, activeId: string | null, local: boolean) {
  const nodes = new Map<string, GNode>();
  const edges: [string, string][] = [];
  const add = (id: string, label: string, kind: NodeKind) => {
    if (!nodes.has(id)) nodes.set(id, { id, label, kind, x: 0, y: 0, vx: 0, vy: 0, degree: 0 });
  };

  notes.forEach((n) => add(n.id, n.title, 'note'));
  notes.forEach((n) => {
    n.links.forEach((link) => {
      const target = resolveLink(link, notes);
      if (target) {
        if (target.id !== n.id) edges.push([n.id, target.id]);
      } else if (settings.showMissing) {
        const id = `missing:${link.toLowerCase()}`;
        add(id, link, 'missing');
        edges.push([n.id, id]);
      }
    });
    if (settings.showTags) {
      n.tags.forEach((tag) => {
        add(`tag:${tag}`, `#${tag}`, 'tag');
        edges.push([n.id, `tag:${tag}`]);
      });
    }
  });

  // Қайталанатын қабырғаларды алып тастау (A→B және B→A — бір сызық)
  const seen = new Set<string>();
  let unique = edges.filter(([a, b]) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let keep: Set<string> | null = null;
  if (local && activeId && nodes.has(activeId)) {
    keep = new Set([activeId]);
    for (let d = 0; d < settings.depth; d++) {
      const frontier = [...keep];
      unique.forEach(([a, b]) => {
        if (frontier.includes(a)) keep!.add(b);
        if (frontier.includes(b)) keep!.add(a);
      });
    }
  }
  const q = settings.filter.trim().toLowerCase();
  if (q) {
    const matched = new Set([...nodes.values()].filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id));
    keep = keep ? new Set([...keep].filter((id) => matched.has(id))) : matched;
  }
  if (keep) {
    unique = unique.filter(([a, b]) => keep!.has(a) && keep!.has(b));
    [...nodes.keys()].forEach((id) => !keep!.has(id) && nodes.delete(id));
  }
  unique.forEach(([a, b]) => {
    nodes.get(a)!.degree++;
    nodes.get(b)!.degree++;
  });
  if (!settings.showOrphans && !local) {
    [...nodes.values()].forEach((n) => n.degree === 0 && n.id !== activeId && nodes.delete(n.id));
  }
  return { nodes: [...nodes.values()], edges: unique.filter(([a, b]) => nodes.has(a) && nodes.has(b)) };
}

const NotesGraph: React.FC<Props> = ({ notes, activeId, local = false, onOpen, onOpenLink, onTag }) => {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [settings, setSettings] = useState<Settings>({ showTags: false, showMissing: true, showOrphans: true, depth: 1, filter: '' });
  const [panelOpen, setPanelOpen] = useState(false);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const handlers = useRef({ onOpen, onOpenLink, onTag });
  handlers.current = { onOpen, onOpenLink, onTag };

  const graph = useMemo(() => buildGraph(notes, settings, activeId, local), [notes, settings, activeId, local]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d')!;
    const saved = positions.current;

    // Бұрынғы орындарын сақтаймыз — граф жаңарғанда «секірмейді»
    const nodes: GNode[] = graph.nodes.map((n, i) => {
      const prev = saved.get(n.id);
      const angle = i * 2.39996;
      const r = 30 * Math.sqrt(i + 1);
      return { ...n, x: prev?.x ?? Math.cos(angle) * r, y: prev?.y ?? Math.sin(angle) * r };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: GEdge[] = graph.edges.map(([a, b]) => ({ a: byId.get(a)!, b: byId.get(b)! }));
    const neighbors = new Map<string, Set<string>>();
    edges.forEach(({ a, b }) => {
      neighbors.set(a.id, (neighbors.get(a.id) ?? new Set()).add(b.id));
      neighbors.set(b.id, (neighbors.get(b.id) ?? new Set()).add(a.id));
    });

    const colors = {
      node: cssVar(wrap, '--nt-graph-node', '#8a8a8a'),
      active: cssVar(wrap, '--nt-accent', '#f59e0b'),
      missing: cssVar(wrap, '--nt-graph-missing', '#555'),
      tag: cssVar(wrap, '--nt-graph-tag', '#34d399'),
      edge: cssVar(wrap, '--nt-graph-edge', 'rgba(128,128,128,0.35)'),
      text: cssVar(wrap, '--nt-text', '#ddd'),
      bg: cssVar(wrap, '--nt-bg', '#0a0a0a'),
    };

    let width = 0;
    let height = 0;
    const view = { x: 0, y: 0, k: local ? 1.2 : 1 };
    let alpha = 1;
    let hover: GNode | null = null;
    let drag: { node: GNode | null; startX: number; startY: number; moved: boolean; vx: number; vy: number } | null = null;
    let frame = 0;
    // Локал граф қолданушы өзі жылжытқанша/масштабтағанша панельге автоматты сыйып тұрады
    let autoFit = local;

    const resize = () => {
      // clientWidth — panel ашылу анимациясындағы transform: scale әсер етпейді
      width = wrap.clientWidth;
      height = wrap.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      alpha = Math.max(alpha, 0.1);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const radius = (n: GNode) => (n.kind === 'tag' ? 3.5 : 3 + Math.sqrt(n.degree) * 1.6);

    const tick = () => {
      if (alpha < 0.005) return;
      const n = nodes.length;
      // Тебілу (O(n²) — жеке vault үшін жеткілікті)
      for (let i = 0; i < n; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < n; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
          if (d2 > 250000) continue;
          const f = (900 * alpha) / d2;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      }
      // Серіппелер
      edges.forEach(({ a, b }) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 60) / d) * 0.06 * alpha;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      });
      nodes.forEach((node) => {
        // Ортаға тарту
        node.vx -= node.x * 0.004 * alpha;
        node.vy -= node.y * 0.004 * alpha;
        if (node.fixed) { node.vx = 0; node.vy = 0; return; }
        node.vx *= 0.6; node.vy *= 0.6;
        node.x += node.vx; node.y += node.vy;
      });
      alpha *= 0.985;
    };

    const toWorld = (sx: number, sy: number) => ({ x: (sx - width / 2 - view.x) / view.k, y: (sy - height / 2 - view.y) / view.k });

    const fit = () => {
      if (!autoFit || !nodes.length || !width || !height) return;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      nodes.forEach((n) => {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
      });
      // Жазулар үшін шетінен орын қалдырамыз
      const padX = 56;
      const padY = 36;
      const k = Math.min(1.2, (width - padX * 2) / Math.max(1, maxX - minX), (height - padY * 2) / Math.max(1, maxY - minY));
      view.k = Math.max(0.3, k);
      view.x = -((minX + maxX) / 2) * view.k;
      view.y = -((minY + maxY) / 2) * view.k;
    };

    const draw = () => {
      fit();
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2 + view.x, height / 2 + view.y);
      ctx.scale(view.k, view.k);
      const focus = hover ?? null;
      const near = focus ? neighbors.get(focus.id) ?? new Set<string>() : null;

      ctx.lineWidth = 1 / view.k;
      edges.forEach(({ a, b }) => {
        const lit = focus && (a === focus || b === focus);
        ctx.strokeStyle = lit ? colors.active : colors.edge;
        ctx.globalAlpha = focus && !lit ? 0.25 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      });

      // Локал графта түйін аз — жазулар әрқашан көрінеді
      const showLabels = local || view.k > 0.65;
      nodes.forEach((node) => {
        const dim = focus && node !== focus && !near!.has(node.id);
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.fillStyle =
          node.id === activeId || node === focus ? colors.active : node.kind === 'missing' ? colors.missing : node.kind === 'tag' ? colors.tag : colors.node;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius(node), 0, Math.PI * 2);
        ctx.fill();
        if (showLabels || node === focus || node.id === activeId) {
          ctx.font = `${local ? 11 / view.k : 12 / Math.max(view.k, 0.8)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = colors.text;
          ctx.globalAlpha = dim ? 0.2 : node === focus ? 1 : 0.8;
          ctx.fillText(node.label.length > 32 ? `${node.label.slice(0, 30)}…` : node.label, node.x, node.y + radius(node) + 12 / view.k);
        }
      });
      ctx.restore();
      ctx.globalAlpha = 1;
    };

    const loop = () => {
      tick();
      draw();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const pick = (sx: number, sy: number): GNode | null => {
      const p = toWorld(sx, sy);
      let best: GNode | null = null;
      let bestD = Infinity;
      nodes.forEach((node) => {
        const d = Math.hypot(node.x - p.x, node.y - p.y);
        if (d < Math.max(radius(node) + 4, 8 / view.k) && d < bestD) { best = node; bestD = d; }
      });
      return best;
    };

    const local2 = (e: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent) => {
      const { sx, sy } = local2(e);
      const node = pick(sx, sy);
      if (!node) autoFit = false;
      drag = { node, startX: sx, startY: sy, moved: false, vx: view.x, vy: view.y };
      if (node) node.fixed = true;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const { sx, sy } = local2(e);
      if (!drag) {
        const h = pick(sx, sy);
        if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; }
        return;
      }
      if (Math.hypot(sx - drag.startX, sy - drag.startY) > 3) {
        drag.moved = true;
        autoFit = false;
      }
      if (drag.node) {
        const p = toWorld(sx, sy);
        drag.node.x = p.x;
        drag.node.y = p.y;
        alpha = Math.max(alpha, 0.3);
      } else {
        view.x = drag.vx + sx - drag.startX;
        view.y = drag.vy + sy - drag.startY;
      }
    };
    const onUp = () => {
      if (!drag) return;
      const { node, moved } = drag;
      if (node) {
        node.fixed = false;
        if (!moved) {
          if (node.kind === 'note') handlers.current.onOpen(node.id);
          else if (node.kind === 'tag') handlers.current.onTag(node.id.slice(4));
          else handlers.current.onOpenLink(node.label);
        }
      }
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      autoFit = false;
      const { sx, sy } = local2(e);
      const before = toWorld(sx, sy);
      view.k = Math.min(4, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = sx - width / 2 - before.x * view.k;
      view.y = sy - height / 2 - before.y * view.k;
    };
    const onLeave = () => { hover = null; };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      nodes.forEach((n) => saved.set(n.id, { x: n.x, y: n.y }));
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [graph, activeId, local]);

  const toggle = (key: 'showTags' | 'showMissing' | 'showOrphans') => setSettings((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className={`nt-graph${local ? ' nt-graph--local' : ''}`} ref={wrapRef}>
      <canvas ref={canvasRef} className="nt-graph__canvas" />
      <div className="nt-graph__stats">
        {t('notes.graph.stats', { nodes: graph.nodes.length, edges: graph.edges.length })}
      </div>
      <button type="button" className="nt-graph__toggle nt-icon-btn" onClick={() => setPanelOpen((v) => !v)} title={t('notes.graph.settings')}>
        ⚙
      </button>
      {panelOpen && (
        <div className="nt-graph__panel">
          <input
            className="nt-input"
            value={settings.filter}
            onChange={(e) => setSettings((s) => ({ ...s, filter: e.target.value }))}
            placeholder={t('notes.graph.filter')}
          />
          <label><input type="checkbox" checked={settings.showTags} onChange={() => toggle('showTags')} /> {t('notes.graph.tags')}</label>
          <label><input type="checkbox" checked={settings.showMissing} onChange={() => toggle('showMissing')} /> {t('notes.graph.missing')}</label>
          {!local && <label><input type="checkbox" checked={settings.showOrphans} onChange={() => toggle('showOrphans')} /> {t('notes.graph.orphans')}</label>}
          {local && (
            <label>
              {t('notes.graph.depth')}
              <input type="range" min={1} max={3} value={settings.depth} onChange={(e) => setSettings((s) => ({ ...s, depth: Number(e.target.value) }))} />
              {settings.depth}
            </label>
          )}
        </div>
      )}
    </div>
  );
};

export default NotesGraph;
