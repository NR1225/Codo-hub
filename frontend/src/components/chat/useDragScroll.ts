import { useCallback, useRef } from 'react';

/* Көлденең жолақты компьютерде де айналдыру: тінтуірмен басып тұрып сүйреу
   және дөңгелекті (тік) көлденеңге аудару. Сенсорлы экранда браузердің өз скролы қалады. */

const DRAG_THRESHOLD = 5;

function attach(el: HTMLElement) {
  let startX = 0;
  let startScroll = 0;
  let pointerId: number | null = null;
  let dragged = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (el.scrollWidth <= el.clientWidth) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startScroll = el.scrollLeft;
    dragged = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    const dx = e.clientX - startX;
    if (!dragged && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!dragged) {
      dragged = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
    }
    el.scrollLeft = startScroll - dx;
  };

  const endDrag = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    el.classList.remove('is-dragging');
    if (el.hasPointerCapture(e.pointerId))
      el.releasePointerCapture(e.pointerId);
  };

  // Сүйрегеннен кейінгі «click» батырманы басып жібермесін
  const onClickCapture = (e: MouseEvent) => {
    if (!dragged) return;
    dragged = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onWheel = (e: WheelEvent) => {
    if (el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
    if (next === el.scrollLeft) return;
    e.preventDefault();
    el.scrollLeft = next;
  };

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('click', onClickCapture, true);
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', endDrag);
    el.removeEventListener('pointercancel', endDrag);
    el.removeEventListener('click', onClickCapture, true);
    el.removeEventListener('wheel', onWheel);
  };
}

/** Callback ref: элемент шартты түрде көрсетілсе де (қойынды ауысқанда) қайта қосылады */
export function useDragScroll<T extends HTMLElement>() {
  const cleanupRef = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = el ? attach(el) : null;
  }, []);
}
