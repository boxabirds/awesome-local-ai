import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Rect } from '../../shared/geometry';

/** What the board does when a marquee ends. */
export interface MarqueeController {
  /** The rectangle being dragged, in world units; `null` when there is no marquee on. */
  readonly rect: Rect | null;
  /** Shift + press on empty board space. `screen` is relative to the board area. */
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Let go: whatever the box contains joins the selection. */
  end(screen: Point): void;
  /** Escape, pointercancel, or the pointer taken away: nothing about the selection changes. */
  cancel(): void;
}

export interface MarqueeOptions {
  camera: Camera;
  /** The board's objects: the ones the box is checked against. */
  objects: readonly ObjectSnapshot[];
  /** What the box ended up containing, added to what was already selected. */
  onSelect(ids: readonly string[], additive: boolean): void;
}

/**
 * The rectangle a person drags across empty board space to pick up several objects at once.
 *
 * The box is kept in *world* units, converted from the pointer with the camera as it was when
 * the press happened and as it is now. That is the whole trick of a marquee that behaves while
 * the board moves underneath it: a trackpad pinch in the middle of a drag changes where the
 * pointer is over the board, and a box remembered in pixels would have kept the old answer.
 *
 * Only `end` looks at the document, and only once: the objects that lie *completely* inside the
 * box join the selection, and a box that caught nothing leaves the selection exactly as it was.
 * Cancelled - Escape, pointercancel, capture taken away - it changes nothing at all, which is
 * what makes an interrupted drag something you can just do again.
 */
export function useMarquee({ camera, objects, onSelect }: MarqueeOptions): MarqueeController {
  const [rect, setRect] = useState<Rect | null>(null);
  const activeRef = useRef(false);
  const startRef = useRef<Point>({ x: 0, y: 0 });
  // The latest camera, objects and callback, for listeners and closures made once.
  const cameraRef = useRef(camera);
  const objectsRef = useRef(objects);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    cameraRef.current = camera;
    objectsRef.current = objects;
    onSelectRef.current = onSelect;
  });

  const worldOf = useCallback((screen: Point): Point => {
    return screenToWorld(cameraRef.current, screen);
  }, []);

  const begin = useCallback(
    (screen: Point): void => {
      const start = worldOf(screen);
      activeRef.current = true;
      startRef.current = start;
      setRect({ x: start.x, y: start.y, width: 0, height: 0 });
    },
    [worldOf],
  );

  const move = useCallback(
    (screen: Point): void => {
      if (!activeRef.current) {
        return;
      }
      setRect(normalizeRect(startRef.current, worldOf(screen)));
    },
    [worldOf],
  );

  const end = useCallback(
    (screen: Point): void => {
      if (!activeRef.current) {
        return;
      }
      activeRef.current = false;
      const box = normalizeRect(startRef.current, worldOf(screen));
      setRect(null);
      const ids = objectsInRect(objectsRef.current, box);
      if (ids.length > 0) {
        // Additive: a marquee adds to what is already selected, it does not replace it.
        onSelectRef.current(ids, true);
      }
    },
    [worldOf],
  );

  const cancel = useCallback((): void => {
    if (!activeRef.current) {
      return;
    }
    activeRef.current = false;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  /** The box in progress, in world units; `null` while no marquee is being dragged. */
  rect: Rect | null;
  /** The camera, whose zoom the border is divided by so the line stays a line. */
  camera: Camera;
}

/**
 * The translucent rectangle of a marquee in progress, drawn in the world layer.
 *
 * It is where the box *is*, in board units, so it says the same thing on every zoom level and
 * never disagrees with what the box will select. The border is divided by the zoom for the same
 * reason a selection handle is: a line that vanishes at 10% is not feedback.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): JSX.Element | null {
  if (rect === null) {
    return null;
  }
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const line = 1 / zoom;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee"
      data-width={Math.round(rect.width)}
      data-height={Math.round(rect.height)}
      aria-hidden="true"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderWidth: `${line}px`,
      }}
    />
  );
}
