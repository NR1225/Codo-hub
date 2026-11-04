import React, { useState } from 'react';

/* Консольдегі мән — DevTools-тағыдай: жолдар, сандар, ашылатын объектілер/массивтер,
   қателер (стегімен), DOM элементтері. Пішімі — previewConsoleBridge.js → ser() */

export interface Ser {
  t: 'str' | 'num' | 'bool' | 'null' | 'undef' | 'sym' | 'fn' | 'err' | 'dom' | 'date' | 're' | 'ref' | 'obj' | 'arr';
  v?: string;
  /** Конструктор аты: Object, Array(3), Map(2) … */
  n?: string;
  /** Қате стегі / функция мәтіні */
  s?: string;
  /** DOM элементінің outerHTML-і */
  h?: string;
  e?: [string, Ser][] | null;
  more?: number;
}

/** Бір жолдық қысқа көрінісі: {a: 1, b: Array(3)} */
function preview(v: Ser, depth = 0): string {
  switch (v.t) {
    case 'str': return depth ? JSON.stringify(v.v ?? '') : v.v ?? '';
    case 'num': case 'bool': case 'sym': case 'date': case 're': case 'ref': return v.v ?? '';
    case 'null': return 'null';
    case 'undef': return 'undefined';
    case 'fn': return `ƒ ${v.v}()`;
    case 'err': return `${v.n}: ${v.v}`;
    case 'dom': return v.v ?? '';
    case 'arr':
    case 'obj': {
      if (!v.e) return v.t === 'arr' ? `${v.n} […]` : `${v.n} {…}`;
      if (depth > 0) return v.t === 'arr' ? v.n ?? 'Array' : v.n === 'Object' ? '{…}' : v.n ?? '{…}';
      const parts = v.e.slice(0, 6).map(([k, x]) => (v.t === 'arr' ? preview(x, 1) : `${k}: ${preview(x, 1)}`));
      const tail = v.e.length > 6 || v.more ? ', …' : '';
      const body = parts.join(', ') + tail;
      if (v.t === 'arr') return `${v.n ?? ''} [${body}]`;
      return `${v.n && v.n !== 'Object' ? `${v.n} ` : ''}{${body}}`;
    }
    default: return '';
  }
}

interface ValueProps {
  value: Ser;
  /** Жолдың басындағы мәтін (console.log('мәтін')) — тырнақшасыз көрсетіледі */
  top?: boolean;
  name?: string;
}

const Prim: React.FC<{ v: Ser; top?: boolean }> = ({ v, top }) => {
  const text = preview(v, top ? 0 : 1);
  return <span className={`vx-cv vx-cv--${v.t}${top && v.t === 'str' ? ' is-plain' : ''}`}>{text}</span>;
};

export const ConsoleValue: React.FC<ValueProps> = ({ value, top, name }) => {
  const [open, setOpen] = useState(false);
  const expandable = ((value.t === 'obj' || value.t === 'arr') && !!value.e && value.e.length > 0)
    || (value.t === 'err' && !!value.s)
    || (value.t === 'dom' && !!value.h)
    || (value.t === 'fn' && !!value.s);

  const label = name !== undefined && <span className="vx-cv__key">{name}: </span>;

  if (!expandable) {
    return <span className="vx-cv__node">{label}<Prim v={value} top={top && name === undefined} /></span>;
  }

  return (
    <span className={`vx-cv__node is-tree ${open ? 'is-open' : ''}`}>
      <button type="button" className="vx-cv__toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="vx-cv__caret" aria-hidden="true">▸</span>
        {label}
        <span className={`vx-cv vx-cv--${value.t}`}>{preview(value)}</span>
      </button>
      {open && (
        <span className="vx-cv__children">
          {value.t === 'err' || value.t === 'fn' ? (
            <pre className="vx-cv__stack">{value.s}</pre>
          ) : value.t === 'dom' ? (
            <pre className="vx-cv__stack vx-cv__html">{value.h}</pre>
          ) : (
            <>
              {value.e!.map(([k, x], i) => (
                <span key={`${k}-${i}`} className="vx-cv__row"><ConsoleValue value={x} name={k} /></span>
              ))}
              {!!value.more && <span className="vx-cv__row vx-cv__more">… +{value.more}</span>}
            </>
          )}
        </span>
      )}
    </span>
  );
};

export interface ConsoleTable {
  cols: string[];
  rows: string[][];
}

export const ConsoleTableView: React.FC<{ table: ConsoleTable }> = ({ table }) => (
  <div className="vx-ct">
    <table>
      <thead>
        <tr>
          <th>(index)</th>
          {table.cols.map(c => <th key={c}>{c === '\u0000' ? 'Value' : c}</th>)}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, i) => (
          <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  </div>
);
