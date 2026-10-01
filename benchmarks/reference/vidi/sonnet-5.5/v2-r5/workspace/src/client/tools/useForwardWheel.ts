import { useEffect, type RefObject } from 'react';

/** A tool layer covers the board, so it hands wheel (pan and zoom) events on to the viewport underneath. */
export function useForwardWheel(layer: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const viewport = document.querySelector('[data-testid="board-viewport"]');
      if (!viewport) return;
      e.preventDefault();
      viewport.dispatchEvent(new WheelEvent('wheel', e));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [layer]);
}
