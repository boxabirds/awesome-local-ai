import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';
import { isRegisteredType } from '../objects/registry';

/** Marquee outline thickness in screen px (kept constant at every zoom). */
const OUTLINE_SCREEN_PX = 1;

export interface Marquee {
  /** Current rectangle in world units, or null when no marquee is being drawn. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Selects (adds) every registered object entirely inside the rectangle. */
  end(): void;
  /** Discards the rectangle; the selection is unchanged. */
  cancel(): void;
}

/**
 * Shift+drag selection rectangle (sel.marquee_ui). Screen points are relative to the board
 * area; the rectangle is stored in world units so zooming during the drag is harmless.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  const live = useRef({ camera, snapshot, onSelect });
  live.current = { camera, snapshot, onSelect };
  const startRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);

  const update = (next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    const start = screenToWorld(live.current.camera, screen);
    startRef.current = start;
    update(normalizeRect(start, start));
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!start) return;
    update(normalizeRect(start, screenToWorld(live.current.camera, screen)));
  }, []);

  const end = useCallback(() => {
    const final = rectRef.current;
    startRef.current = null;
    update(null);
    if (!final) return;
    const ids = objectsInRect(live.current.snapshot, final, isRegisteredType);
    if (ids.length > 0) live.current.onSelect(ids);
  }, []);

  const cancel = useCallback(() => {
    startRef.current = null;
    update(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** The light blue translucent rectangle, drawn in the world layer (above every object via `zIndex`). */
export function MarqueeRect({ rect, camera, zIndex }: { rect: Rect | null; camera: Camera; zIndex?: number }) {
  if (!rect) return null;
  const style: CSSProperties = {
    transform: `translate(${rect.x}px, ${rect.y}px)`,
    width: rect.width,
    height: rect.height,
    borderWidth: `${OUTLINE_SCREEN_PX / camera.zoom}px`,
    zIndex,
  };
  return <div className="marquee" data-testid="marquee" aria-hidden="true" style={style} />;
}
