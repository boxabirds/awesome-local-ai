/**
 * Shift+drag marquee selection (story 7, sel.marquee_ui).
 *
 * `useMarquee(camera, snapshot, onSelect)` tracks the drag in WORLD units
 * (so a zoom change mid-drag is harmless) and, on `end()`, selects exactly
 * the objects fully inside the final rectangle (additive). An empty result
 * leaves the selection unchanged. `cancel()` (pointercancel / lost capture /
 * Escape) discards the rect without touching the selection.
 *
 * `MarqueeRect` draws the translucent rectangle in screen space.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { STICKY_SELECTION_OUTLINE } from '../../shared/config';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';

export interface Marquee {
  /** The current rectangle in world units, or null when inactive. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  end(): void;
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  const [active, setActive] = useState(false);

  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);
  rectRef.current = rect;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point): void => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    setActive(true);
    setRect({ x: world.x, y: world.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point): void => {
    const start = startRef.current;
    if (start === null) {
      return;
    }
    const world = screenToWorld(cameraRef.current, screen);
    setRect(normalizeRect(start, world));
  }, []);

  const end = useCallback((): void => {
    const r = rectRef.current;
    if (startRef.current === null) {
      return;
    }
    startRef.current = null;
    setActive(false);
    setRect(null);
    if (r !== null && (r.width > 0 || r.height > 0)) {
      // Fully-inside containment; an empty result is a no-op for the
      // additive setMany in the selection hook.
      onSelectRef.current(objectsInRect(snapshotRef.current, r));
    }
  }, []);

  const cancel = useCallback((): void => {
    if (startRef.current === null) {
      return;
    }
    startRef.current = null;
    setActive(false);
    setRect(null);
  }, []);

  // Escape cancels the marquee without clearing the existing selection.
  // The listener is on the capture phase and stops immediate propagation so
  // the board's Escape-to-clear (bubble phase) never runs for this event.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') {
        return;
      }
      e.stopImmediatePropagation();
      e.preventDefault();
      cancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

/** The translucent marquee rectangle (screen space). */
export function MarqueeRect({ rect, camera }: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  if (rect === null) {
    return null;
  }
  const tl = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: `${tl.x}px`,
        top: `${tl.y}px`,
        width: `${rect.width * camera.zoom}px`,
        height: `${rect.height * camera.zoom}px`,
        border: `1px solid ${STICKY_SELECTION_OUTLINE}`,
        background: 'rgba(26, 115, 232, 0.08)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
}
