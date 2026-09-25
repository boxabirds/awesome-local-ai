import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { objectsInRect } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera, Point } from '../canvas/camera';

/**
 * Shift+drag marquee selection (story 7, sel.marquee_ui).
 *
 * `begin`/`move` take SCREEN points (viewport-local, as the camera API
 * does); the rect is stored in WORLD units so a zoom change mid-drag is
 * harmless. On `end`, the ids of the objects fully inside the rect are
 * handed to `onSelect` (the selection adds them; an empty result leaves the
 * selection unchanged). `cancel` (pointercancel, lostpointercapture, Escape)
 * discards the rect without touching the selection.
 */
export interface MarqueeApi {
  /** The current rect in world units, or null while idle. */
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
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  /** Synchronous mirror of the latest rect (end() must not read stale state). */
  const liveRectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const begin = useCallback((screen: Point): void => {
    const w = screenToWorld(cameraRef.current, screen);
    startRef.current = w;
    liveRectRef.current = { x: w.x, y: w.y, width: 0, height: 0 };
    setRect(liveRectRef.current);
  }, []);

  const move = useCallback((screen: Point): void => {
    const start = startRef.current;
    if (start === null) return;
    const r = normalizeRect(start, screenToWorld(cameraRef.current, screen));
    liveRectRef.current = r;
    setRect(r);
  }, []);

  const end = useCallback((): void => {
    const start = startRef.current;
    const r = liveRectRef.current;
    startRef.current = null;
    liveRectRef.current = null;
    setRect(null);
    if (start === null || r === null) return;
    const ids = objectsInRect(snapshotRef.current, r);
    if (ids.length > 0) onSelectRef.current(ids);
  }, []);

  const cancel = useCallback((): void => {
    startRef.current = null;
    liveRectRef.current = null;
    setRect(null);
  }, []);

  // Escape cancels an in-flight marquee (selection unchanged).
  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, cancel]);

  return { rect, begin, move, end, cancel };
}

/**
 * The translucent marquee rectangle, drawn in screen space above the world
 * layer (a constant 1px border at any zoom).
 */
export function MarqueeRect(props: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  const { rect, camera } = props;
  if (rect === null) return null;
  if (rect.width <= 0 && rect.height <= 0) return null;
  const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="vidi6-marquee"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        left: topLeft.x,
        top: topLeft.y,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom,
      }}
    />
  );
}
