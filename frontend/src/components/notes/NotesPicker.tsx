import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyScore } from './noteLinks';

export interface PickerItem {
  id: string;
  label: string;
  hint?: string;
}

interface Props {
  placeholder: string;
  items: PickerItem[];
  /** Сәйкестік болмаса — енгізілген мәтінмен жаңа элемент жасау (мысалы, жаңа жазба) */
  createLabel?: (query: string) => string;
  onPick: (item: PickerItem) => void;
  onCreate?: (query: string) => void;
  onClose: () => void;
}

/** Ctrl+O сияқты жылдам таңдау терезесі: бұлыңғыр іздеу + пернетақтамен басқару */
const NotesPicker: React.FC<Props> = ({ placeholder, items, createLabel, onPick, onCreate, onClose }) => {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(
    () =>
      items
        .map((item) => ({ item, score: Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.hint ?? '') - 50) }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50)
        .map((x) => x.item),
    [items, query]
  );
  const canCreate = !!onCreate && !!query.trim() && !filtered.some((i) => i.label.toLowerCase() === query.trim().toLowerCase());
  const total = filtered.length + (canCreate ? 1 : 0);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const choose = (i: number) => {
    if (i < filtered.length) onPick(filtered[i]);
    else if (canCreate) onCreate!(query.trim());
    onClose();
  };

  return (
    <div className="nt-modal" onMouseDown={onClose}>
      <div className="nt-picker" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="nt-picker__input"
          autoFocus
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (!total) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((index + 1) % total); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((index - 1 + total) % total); }
            if (e.key === 'Enter') { e.preventDefault(); choose(index); }
          }}
        />
        <div className="nt-picker__list" ref={listRef}>
          {filtered.map((item, i) => (
            <button
              key={item.id}
              type="button"
              className={`nt-picker__item${i === index ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              <span>{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              className={`nt-picker__item nt-picker__item--create${index === filtered.length ? ' is-active' : ''}`}
              onMouseEnter={() => setIndex(filtered.length)}
              onClick={() => choose(filtered.length)}
            >
              <span>{createLabel ? createLabel(query.trim()) : query.trim()}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotesPicker;
