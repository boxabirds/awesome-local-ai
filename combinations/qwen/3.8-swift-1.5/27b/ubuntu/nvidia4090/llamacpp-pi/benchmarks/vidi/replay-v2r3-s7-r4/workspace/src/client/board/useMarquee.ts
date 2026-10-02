import { useCallback, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';

/**
 * Story 7: shift+drag marquee selection (sel.marquee).
 *
 * `begin(e)` arms the marquee from a shift+pointerdown on empty board space;
 * `screenRect` is the live marquee rect in screen pixels (for rendering);
 * on pointerup the fully-contained objects are selected (additively when
 * shift is held — which it always is, to start a marquee).
 */
export interface MarqueeApi {
  active: boolean;
  screenRect: Rect | null;
  begin: (e: PointerEvent) => void;
}

export interface MarqueeOptions {
  toWorld: (clientX: number, clientY: number) => Point;
  toScreen: (world: Point) => Point;
  zoom: () => number;
  getSnapshot: () => readonly ObjectSnapshot[];
  onSelect: (ids: string[], additive: boolean) => void;
}

export function useMarquee(opts: MarqueeOptions): MarqueeApi {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const [active, setActive] = useState(false);
  const [screenRect, setScreenRect] = useState<Rect | null>(null);
  const startWorldRef = useRef<Point | null>(null);

  const updateRect = useCallback((world: Point) => {
    const start = startWorldRef.current;
    if (!start) return;
    const rect = normalizeRect(start, world);
    const { toScreen, zoom } = optsRef.current;
    const tl = toScreen({ x: rect.x, y: rect.y });
    setScreenRect({
      x: tl.x,
      y: tl.y,
      width: rect.width * zoom(),
      height: rect.height * zoom(),
    });
  }, []);

  const cleanupRef = useRef<() => void>(() => {});

  const onMove = useCallback(
    (e: PointerEvent) => {
      updateRect(optsRef.current.toWorld(e.clientX, e.clientY));
    },
    [updateRect],
  );

  const finish = useCallback(() => {
    startWorldRef.current = null;
    setActive(false);
    setScreenRect(null);
    cleanupRef.current();
  }, []);

  const onUp = useCallback(
    (e: PointerEvent) => {
      const start = startWorldRef.current;
      if (start) {
        const rect = normalizeRect(start, optsRef.current.toWorld(e.clientX, e.clientY));
        const ids = objectsInRect(optsRef.current.getSnapshot(), rect);
        optsRef.current.onSelect(ids, true);
      }
      finish();
    },
    [finish],
  );

  // A cancelled marquee must not apply any selection.
  const onCancel = useCallback(() => finish(), [finish]);

  const cleanup = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  }, [onMove, onUp, onCancel]);
  cleanupRef.current = cleanup;

  const begin = useCallback(
    (e: PointerEvent) => {
      startWorldRef.current = optsRef.current.toWorld(e.clientX, e.clientY);
      setActive(true);
      setScreenRect(null);
      updateRect(optsRef.current.toWorld(e.clientX, e.clientY));
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    },
    [onMove, onUp, onCancel, updateRect],
  );

  return { active, screenRect, begin };
}
