import { useCallback, useEffect, useRef, useState } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';

/**
 * Marquee selection (story 7, sel.marquee).
 *
 * A pale blue translucent rectangle follows the pointer while
 * Shift+pointer-down is active on empty board space. On release, all objects
 * lying fully inside the final rect are added to the selection (additive).
 * Escape (or pointercancel / lostpointercapture) cancels: no selection change,
 * no rectangle.
 */
export interface MarqueeApi {
  rect: Rect | null;
  /** Start a marquee at a screen point. */
  begin(screen: Point): void;
  /** Extend the marquee to a screen point. */
  move(screen: Point): void;
  /** Release: apply the (additive) selection for the final rect. */
  end(): void;
  /** Abort: no selection change. */
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);

  const begin = useCallback((screen: Point) => {
    const world = screenToWorld(cameraRef.current, screen);
    startRef.current = world;
    const r = normalizeRect(world, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    const world = screenToWorld(cameraRef.current, screen);
    const r = normalizeRect(start, world);
    rectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
    if (!r || (r.width === 0 && r.height === 0)) return;
    const ids = objectsInRect(snapshotRef.current, r);
    if (ids.length > 0) onSelectRef.current(ids);
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  // Escape while the marquee is active cancels it. Capture phase +
  // stopPropagation so the board's global key handler (which clears the
  // selection on Escape) never sees this event.
  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancelRef.current();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);

  return { rect, begin, move, end, cancel };
}

/**
 * The pale blue translucent marquee rectangle (screen space).
 * Pure rendering: takes the current rect and camera.
 */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): React.ReactElement | null {
  const { rect, camera } = props;
  if (!rect) return null;
  const left = (rect.x - camera.x) * camera.zoom;
  const top = (rect.y - camera.y) * camera.zoom;
  return (
    <div
      data-testid="marquee-rect"
      style={{
        position: 'fixed',
        left,
        top,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom,
        background: 'rgba(33, 150, 243, 0.15)',
        border: '1px solid rgba(33, 150, 243, 0.8)',
        pointerEvents: 'none',
        zIndex: 26,
        boxSizing: 'border-box',
      }}
    />
  );
}
