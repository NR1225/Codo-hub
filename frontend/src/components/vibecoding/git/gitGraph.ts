import type { GitCommitDTO } from '../../../utils/api';

/** Бір жолдағы сызық: (fromCol, жоғарғы/ортаңғы y) → (toCol, ортаңғы/төменгі y) */
export interface GraphEdge {
  from: number;
  to: number;
  /** top — жолдың жоғарғы жартысы (алдыңғы жолдан келеді), bottom — төменгі жартысы */
  half: 'top' | 'bottom';
  /** Түс индексі — сызық қай бағанның (бұтақтың) жалғасы */
  color: number;
}

export interface GraphRow {
  commit: GitCommitDTO;
  col: number;
  color: number;
  edges: GraphEdge[];
  /** Осы жолдағы ең көп баған саны (ені үшін) */
  width: number;
  isMerge: boolean;
}

interface Lane {
  sha: string;
  color: number;
}

/**
 * Коммиттер тізімінен (topo-order) граф жолдарын құру.
 * Әр баған («lane») келесі күтілетін коммиттің sha-сын сақтайды.
 */
export function buildGraph(commits: GitCommitDTO[]): { rows: GraphRow[]; maxWidth: number } {
  const lanes: (Lane | null)[] = [];
  let nextColor = 0;
  const rows: GraphRow[] = [];
  let maxWidth = 1;

  const freeSlot = (after: number): number => {
    for (let i = after + 1; i < lanes.length; i++) if (!lanes[i]) return i;
    for (let i = 0; i <= after && i < lanes.length; i++) if (!lanes[i]) return i;
    return lanes.length;
  };

  for (const commit of commits) {
    const edges: GraphEdge[] = [];
    let col = lanes.findIndex((l) => l?.sha === commit.sha);
    let color: number;
    // Бұтақтың ұшы (оны ешкім күтпеген) — жаңа баған, жоғарыдан сызық келмейді
    const isTip = col === -1;
    if (isTip) {
      col = freeSlot(-1);
      color = nextColor++;
      lanes[col] = { sha: commit.sha, color };
    } else {
      color = lanes[col]!.color;
    }

    // Жоғарғы жарты: осы коммитке келетін барлық бағандар бірігеді, қалғаны тік өтеді
    lanes.forEach((lane, i) => {
      if (!lane) return;
      if (lane.sha === commit.sha) {
        if (!(isTip && i === col)) edges.push({ from: i, to: col, half: 'top', color: lane.color });
        if (i !== col) lanes[i] = null;
      } else {
        edges.push({ from: i, to: i, half: 'top', color: lane.color });
      }
    });

    // Төменгі жарты: ата-аналар
    const [first, ...others] = commit.parents;
    if (first) {
      const existing = lanes.findIndex((l, i) => i !== col && l?.sha === first);
      if (existing !== -1) {
        // Ата-ана басқа бағанда күтіліп тұр — сонда қосыламыз, бұл баған бітеді
        edges.push({ from: col, to: existing, half: 'bottom', color: lanes[existing]!.color });
        lanes[col] = null;
      } else {
        lanes[col] = { sha: first, color };
        edges.push({ from: col, to: col, half: 'bottom', color });
      }
    } else {
      lanes[col] = null;
    }
    for (const parent of others) {
      let idx = lanes.findIndex((l) => l?.sha === parent);
      if (idx === -1) {
        idx = freeSlot(col);
        lanes[idx] = { sha: parent, color: nextColor++ };
      }
      edges.push({ from: col, to: idx, half: 'bottom', color: lanes[idx]!.color });
    }
    // Өтпелі бағандардың төменгі жартысы
    lanes.forEach((lane, i) => {
      if (!lane || i === col) return;
      if (edges.some((e) => e.half === 'top' && e.from === i && e.to === i)) {
        edges.push({ from: i, to: i, half: 'bottom', color: lane.color });
      }
    });
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();

    const width = Math.max(
      col + 1,
      ...edges.map((e) => Math.max(e.from, e.to) + 1),
    );
    maxWidth = Math.max(maxWidth, width);
    rows.push({ commit, col, color, edges, width, isMerge: commit.parents.length > 1 });
  }
  return { rows, maxWidth };
}

export const GRAPH_COLORS = [
  '#4f9dff', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#f97316',
];

export const graphColor = (i: number) => GRAPH_COLORS[i % GRAPH_COLORS.length];

/** "2 сағ бұрын" сияқты қысқа уақыт */
export function relativeTime(unix: number, locale: string): string {
  const diff = Date.now() / 1000 - unix;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'], [3600, 'minute'], [86400, 'hour'], [604800, 'day'], [2629800, 'week'], [31557600, 'month'],
  ];
  let unit: Intl.RelativeTimeFormatUnit = 'year';
  let div = 31557600;
  const sizes = [1, 60, 3600, 86400, 604800, 2629800];
  for (let i = 0; i < steps.length; i++) {
    if (diff < steps[i][0]) {
      unit = steps[i][1];
      div = sizes[i];
      break;
    }
  }
  return rtf.format(-Math.round(diff / div), unit);
}
