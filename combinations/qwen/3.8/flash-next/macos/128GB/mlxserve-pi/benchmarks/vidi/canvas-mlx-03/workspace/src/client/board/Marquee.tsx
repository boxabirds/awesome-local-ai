// Marquee (box) selection (design `sel.marquee_ui`).
//
// Shift+drag on empty board space draws a translucent rectangle; on release
// every object lying *entirely* inside it joins the selection. A drag that only
// touches an object does not select it, and a drag that encloses nothing leaves
// the selection exactly as it was. Escape or a cancelled pointer aborts it.
//
// The rectangle is stored in world units, so zooming during the drag (a trackpad
// pinch, say) cannot distort what it covers.

import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model.ts';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry.ts';
import { screenToWorld, type Camera } from '../canvas/camera.ts';

/** The four calls `BoardViewport` makes while a marquee is being dragged. */
export interface MarqueeControls {
  /** Shift+pointerdown on empty space, in viewport-relative screen pixels. */
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Release: the objects inside are handed to `onSelect`. */
  end(): void;
  /** Escape or a cancelled pointer: draw nothing, select nothing. */
  cancel(): void;
}

export interface Marquee extends MarqueeControls {
  /** The rectangle being drawn, in world units, or null when idle. */
  rect: Rect | null;
  /** True between begin and end/cancel. */
  active: boolean;
}

/**
 * The marquee drag. `onSelect` receives the ids to add (empty when the box
 * caught nothing, which the selection treats as "change nothing").
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  // Live values behind refs, so the window listeners registered once never see
  // a stale camera, snapshot or callback.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [rect, setRect] = useState<Rect | null>(null);
  const [active, setActive] = useState(false);
  const rectRef = useRef<Rect | null>(null);
  rectRef.current = rect;
  const activeRef = useRef(active);
  activeRef.current = active;
  const startRef = useRef<Point>({ x: 0, y: 0 });

  const begin = useCallback((screen: Point) => {
    startRef.current = screenToWorld(cameraRef.current, screen);
    activeRef.current = true;
    setActive(true);
    setRect({ x: startRef.current.x, y: startRef.current.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    if (!activeRef.current) return;
    const world = screenToWorld(cameraRef.current, screen);
    const next = normalizeRect(startRef.current, world);
    rectRef.current = next;
    setRect(next);
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    rectRef.current = null;
    setActive(false);
    setRect(null);
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    const r = rectRef.current;
    stop();
    if (!r) return;
    onSelectRef.current(objectsInRect(snapshotRef.current, r));
  }, [stop]);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    stop(); // the selection is left untouched
  }, [stop]);

  // Escape aborts the drag in flight. It is caught on the way *in* so the
  // "Escape clears the selection" shortcut never fires for it.
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      cancelRef.current();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [active]);

  return useMemo(
    () => ({ rect, active, begin, move, end, cancel }),
    [rect, active, begin, move, end, cancel],
  );
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/**
 * The translucent selection rectangle, rendered inside the zoomed world layer.
 * Its border is divided by the zoom so it keeps looking like a 1 CSS pixel line
 * at 50% and at 200%.
 */
export function MarqueeRect(props: MarqueeRectProps): ReactElement | null {
  const { rect, camera } = props;
  if (!rect) return null;
  if (!(rect.width > 0) && !(rect.height > 0)) return null;
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  return (
    <div
      data-testid="marquee-rect"
      aria-hidden
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        background: 'rgba(47,111,237,0.12)',
        border: `${1 / zoom}px solid rgba(47,111,237,0.9)`,
        borderRadius: 2 / zoom,
      }}
    />
  );
}
