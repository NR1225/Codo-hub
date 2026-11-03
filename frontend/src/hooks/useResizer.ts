import { useState, useRef, useCallback, useEffect } from 'react';

export interface PanelSizes {
  left: number;
  center: number;
  right: number;
  bottom: number;
}

interface UseResizerOptions {
  initialSizes: PanelSizes;
  minLeft?: number;
  minRight?: number;
  minBottom?: number;
  minCenter?: number;
  /** Ортаңғы бағанның ең кіші ені (px) — пайызбен қатар тексеріледі */
  minCenterPx?: number;
  /** Оң панельдің ең үлкен ені (%) */
  maxRight?: number;
  /** Жабық панель орын алмайды — қарсы панельді соның есебінен кеңейтуге болады */
  leftVisible?: boolean;
  rightVisible?: boolean;
  onSizesChange?: (sizes: PanelSizes) => void;
  disabled?: boolean;
}

export function useResizer({
  initialSizes,
  minLeft = 15,
  minRight = 15,
  minBottom = 15,
  minCenter = 30,
  minCenterPx = 0,
  maxRight = 100,
  leftVisible = true,
  rightVisible = true,
  onSizesChange,
  disabled = false,
}: UseResizerOptions) {
  const [sizes, setSizes] = useState<PanelSizes>(initialSizes);
  const isDragging = useRef(false);
  const dragType = useRef<'left' | 'right' | 'bottom' | null>(null);
  const startPos = useRef({ x: 0, y: 0 });
  const startSizes = useRef<PanelSizes>(initialSizes);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Use ref for callback to avoid infinite re-render loops
  const onSizesChangeRef = useRef(onSizesChange);
  onSizesChangeRef.current = onSizesChange;
  // Latest sizes for the drag-end notification (calling the parent from inside a
  // setSizes updater would update another component during render)
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const visibleRef = useRef({ left: leftVisible, right: rightVisible });
  visibleRef.current = { left: leftVisible, right: rightVisible };

  const onDragStart = useCallback((
    e: React.MouseEvent,
    type: 'left' | 'right' | 'bottom',
    container: HTMLDivElement
  ) => {
    if (disabled) return;
    e.preventDefault();
    isDragging.current = true;
    dragType.current = type;
    startPos.current = { x: e.clientX, y: e.clientY };
    startSizes.current = { ...sizes };
    containerRef.current = container;
    document.body.style.cursor = type === 'bottom' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.classList.add('is-panel-resizing');
  }, [sizes]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragType.current || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const dx = e.clientX - startPos.current.x;
      const dy = e.clientY - startPos.current.y;

      setSizes(prev => {
        const totalWidth = rect.width;
        const totalHeight = rect.height;
        const deltaPercentX = (dx / totalWidth) * 100;
        const deltaPercentY = (dy / totalHeight) * 100;

        let newSizes = { ...prev };
        // Ортаға қалатын ең кіші орын: пайыз немесе пиксель — қайсысы үлкен болса
        const centerMin = Math.max(minCenter, totalWidth > 0 ? (minCenterPx / totalWidth) * 100 : 0);
        // Қарсы панель нақты қанша орын алып тұр (жабық болса — 0)
        const otherRight = visibleRef.current.right ? startSizes.current.right : 0;
        const otherLeft = visibleRef.current.left ? startSizes.current.left : 0;

        if (dragType.current === 'left') {
          const newLeft = Math.max(minLeft, Math.min(startSizes.current.left + deltaPercentX, 100 - centerMin - otherRight));
          newSizes.left = newLeft;
          newSizes.center = 100 - newLeft - startSizes.current.right;
        } else if (dragType.current === 'right') {
          const newRight = Math.max(minRight, Math.min(startSizes.current.right - deltaPercentX, 100 - centerMin - otherLeft, maxRight));
          newSizes.right = newRight;
          newSizes.center = 100 - startSizes.current.left - newRight;
        } else if (dragType.current === 'bottom') {
          const newBottom = Math.max(minBottom, Math.min(startSizes.current.bottom + deltaPercentY, 70));
          newSizes.bottom = newBottom;
        }

        return newSizes;
      });
    };

    const onMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        dragType.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.classList.remove('is-panel-resizing');
        // Notify parent of final sizes when drag ends
        onSizesChangeRef.current?.(sizesRef.current);
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [minLeft, minRight, minBottom, minCenter, minCenterPx, maxRight]);

  return { sizes, setSizes, onDragStart };
}