import { useEffect } from 'react';

type ViewportWindow = { innerHeight: number; visualViewport?: { height: number; offsetTop: number } | null };

/** Height of the on-screen keyboard: max(0, innerHeight - visualViewport.height - offsetTop); 0 without visualViewport. */
export function computeKeyboardInset(win: ViewportWindow): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  return Math.max(0, win.innerHeight - vv.height - vv.offsetTop);
}

const INSET_PROPERTY = '--kb-inset';

/**
 * While `active` (docked quick add open), keeps `--kb-inset` on the root element equal to the
 * on-screen keyboard's height, so the docked panel sits right above it. Passive listeners, one
 * write per animation frame; removed on close.
 */
export function useKeyboardInset(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const write = () => root.style.setProperty(INSET_PROPERTY, `${computeKeyboardInset(window)}px`);
    write();
    if (!vv) return () => root.style.removeProperty(INSET_PROPERTY);
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        write();
      });
    };
    vv.addEventListener('resize', schedule, { passive: true });
    vv.addEventListener('scroll', schedule, { passive: true });
    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty(INSET_PROPERTY);
    };
  }, [active]);
}
