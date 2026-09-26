import { useEffect } from 'react';

type ViewportLike = { innerHeight: number; visualViewport?: { height: number; offsetTop: number } | null };

/**
 * How far the on-screen keyboard covers the layout viewport: innerHeight minus the visual viewport's
 * height and offset, never negative. 0 when the browser has no visualViewport.
 */
export function computeKeyboardInset(win: ViewportLike): number {
  const viewport = win.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, win.innerHeight - viewport.height - viewport.offsetTop);
}

/**
 * While `active` (docked quick add is open), keeps `--kb-inset` on <html> equal to the keyboard's height,
 * so the docked panel sits directly above it. Passive visualViewport listeners, one write per frame;
 * removed (and the property cleared) on close.
 */
export function useKeyboardInset(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const write = () => {
      frame = 0;
      root.style.setProperty('--kb-inset', `${computeKeyboardInset(window)}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(write);
    };
    schedule();
    viewport.addEventListener('resize', schedule, { passive: true });
    viewport.addEventListener('scroll', schedule, { passive: true });
    return () => {
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      if (frame !== 0) cancelAnimationFrame(frame);
      root.style.removeProperty('--kb-inset');
    };
  }, [active]);
}
