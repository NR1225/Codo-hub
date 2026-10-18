import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './Popover.css';

/* Чат бетіндегі барлық ашылмалы терезелерге ортақ қалқыма (мәзірлер, эмодзи, контекстік мәзір).
   Ашқан батырманың (не курсордың) өзінен үлкейіп шығады және жабылғанда соған қайта кіреді;
   экранға сыймаса — басқа жағына ауысады. body-ге порталмен шығады (.cht-ma-portal — түстер). */

export type PopoverAnchor = React.RefObject<HTMLElement> | { x: number; y: number };
export type PopoverPlacement = 'bottom-end' | 'bottom-start' | 'top-start' | 'top-end';

interface PopoverProps {
  open: boolean;
  /** Батырма (ref) немесе экрандағы нүкте (контекстік мәзір) */
  anchor: PopoverAnchor;
  onClose: () => void;
  placement?: PopoverPlacement;
  className?: string;
  role?: string;
  ariaLabel?: string;
  /** Ашылғанда бірінші [role=menuitem]-ге фокус (мәзірлер үшін) */
  focusFirst?: boolean;
  /** Мәзір элементі басылса — өзі жабылады */
  closeOnSelect?: boolean;
  children: React.ReactNode;
}

/**
 * Мәзір жабылғанда (value → null) соңғы мәнін сақтап тұрады — Popover жабылу анимациясын
 * ескі мазмұнмен ойнатуы үшін. Қайтарады: [көрсетілетін мән, ашық па]
 */
export function useLingering<T>(value: T | null): [T | null, boolean] {
  const last = useRef<T | null>(value);
  if (value) last.current = value;
  return [last.current, !!value];
}

const GAP = 8;
const PAD = 8;

const isPoint = (a: PopoverAnchor): a is { x: number; y: number } => 'x' in a;

const Popover: React.FC<PopoverProps> = ({
  open,
  anchor,
  onClose,
  placement = 'bottom-end',
  className = '',
  role = 'menu',
  ariaLabel,
  focusFirst = true,
  closeOnSelect = true,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; ox: number; oy: number; side: 'top' | 'bottom' } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  // Ашу — бірден, жабу — шығу анимациясы біткен соң
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const anchorRect = useCallback(() => {
    const a = anchorRef.current;
    if (isPoint(a)) return { left: a.x, right: a.x, top: a.y, bottom: a.y };
    return a.current?.getBoundingClientRect() ?? null;
  }, []);

  const place = useCallback(() => {
    const el = ref.current;
    const r = anchorRect();
    if (!el || !r) return;
    // offsetWidth — transform (scale) әсер етпейтін нақты өлшем
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = isPoint(anchorRef.current) ? 2 : GAP;

    const wantTop = placement.startsWith('top');
    const fitsBelow = r.bottom + gap + h <= vh - PAD;
    const fitsAbove = r.top - gap - h >= PAD;
    const side: 'top' | 'bottom' = wantTop ? (fitsAbove || !fitsBelow ? 'top' : 'bottom') : fitsBelow || !fitsAbove ? 'bottom' : 'top';
    let top = side === 'bottom' ? r.bottom + gap : r.top - gap - h;
    top = Math.min(Math.max(PAD, top), Math.max(PAD, vh - h - PAD));

    const alignEnd = placement.endsWith('end');
    let left = alignEnd ? r.right - w : r.left;
    if (isPoint(anchorRef.current) && left + w > vw - PAD) left = r.left - w; // курсордың сол жағына
    left = Math.min(Math.max(PAD, left), Math.max(PAD, vw - w - PAD));

    // Үлкею нүктесі — батырманың ортасы (қалқымаға қатысты, шегінен шығуы мүмкін)
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    setPos({ left, top, ox: cx - left, oy: cy - top, side });
  }, [anchorRect, placement]);

  const pointKey = isPoint(anchor) ? `${anchor.x},${anchor.y}` : '';
  useLayoutEffect(() => {
    if (mounted && !closing) place();
  }, [mounted, closing, place, pointKey]);

  // Сыртқа басу, Esc, өлшем өзгеруі, сырттағы айналдыру — жабу
  useEffect(() => {
    if (!open) return;
    const isInside = (target: EventTarget | null) => {
      const node = target as Node | null;
      if (!node) return false;
      if (ref.current?.contains(node)) return true;
      const a = anchorRef.current;
      return !isPoint(a) && !!a.current?.contains(node);
    };
    const onDown = (e: PointerEvent) => {
      if (!isInside(e.target)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onCloseRef.current();
      const a = anchorRef.current;
      if (!isPoint(a)) a.current?.focus({ preventScroll: true });
    };
    const onWheel = (e: WheelEvent) => {
      if (!ref.current?.contains(e.target as Node)) onCloseRef.current();
    };
    const onResize = () => onCloseRef.current();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (open && pos && focusFirst) {
      ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos === null]);

  // Жоғары/төмен, Home/End — мәзір бойымен жылжу
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
    if (items.length === 0) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  if (!mounted) return null;

  return createPortal(
    <div
      ref={ref}
      className={`cht-ma-portal cht-pop ${closing ? 'is-closing' : ''} ${pos ? `is-${pos.side}` : ''} ${className}`}
      role={role}
      aria-label={ariaLabel}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? undefined : 'hidden',
        transformOrigin: pos ? `${pos.ox}px ${pos.oy}px` : undefined,
      }}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (closeOnSelect && (e.target as HTMLElement).closest('[role="menuitem"]')) onCloseRef.current();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget && closing) {
          setMounted(false);
          setClosing(false);
          setPos(null);
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default Popover;
