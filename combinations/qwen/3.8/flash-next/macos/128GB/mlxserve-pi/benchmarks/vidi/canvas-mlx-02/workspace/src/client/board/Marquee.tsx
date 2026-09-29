// Marquee (rubber-band) selection (story 7, sel.marquee_ui).
//
// Shift + drag on empty canvas draws a translucent rectangle and selects the
// objects FULLY inside it, added to whatever is already selected. Without Shift
// the same drag pans the board, exactly as in story 1, which is why this hook is
// started by BoardViewport only when the pointerdown carries `shiftKey`.
//
// The rectangle is kept in WORLD units: it is converted with `screenToWorld` on
// every move, so zooming (or pinching) mid-drag cannot move it, and
// `objectsInRect` is the same predicate the unit tests cover.
import React, { useCallback, useRef, useState } from 'react';
import type { Camera, Point } from '../canvas/camera.ts';
import { screenToWorld } from '../canvas/camera.ts';
import { normalizeRect, isFiniteRect, type Rect } from '../../shared/geometry.ts';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model.ts';

export interface Marquee {
  /** the rectangle to draw, or null while idle */
  rect: Rect | null;
  /** Shift+pointerdown on empty space, in screen coordinates */
  begin(screen: Point): void;
  /** pointermove, in screen coordinates */
  move(screen: Point): void;
  /** pointerup: selects the objects inside; a marquee over nothing changes nothing */
  end(): void;
  /** pointercancel / Escape: the rectangle disappears, the selection is untouched */
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const activeRef = useRef(false);
  // The latest camera, snapshot and callback: a long drag must not select with
  // the camera or the board it started with.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const store = (next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    const start = screenToWorld(cameraRef.current, screen);
    if (start === null) return;
    startRef.current = start;
    activeRef.current = true;
    store({ x: start.x, y: start.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    const start = startRef.current;
    if (!activeRef.current || start === null) return;
    const point = screenToWorld(cameraRef.current, screen);
    if (point === null) return;
    store(normalizeRect(start, point));
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    startRef.current = null;
    const box = rectRef.current;
    store(null);
    if (box === null || !isFiniteRect(box)) return; // a click, not a drag
    const ids = objectsInRect(snapshotRef.current, box);
    if (ids.length === 0) return; // nothing inside: the selection stays as it was
    selectRef.current(ids);
  }, []);

  const cancel = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    startRef.current = null;
    store(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

// The rectangle itself, rendered INSIDE the world layer (like the sticky notes):
// it is positioned in world units and scaled by the viewport transform, so it
// stays glued to the objects it is selecting. Its border is divided by the zoom
// so it stays one screen pixel at any scale.
export function MarqueeRect({ rect, camera }: MarqueeRectProps): React.JSX.Element | null {
  if (rect === null || !isFiniteRect(rect)) return null;
  return (
    <div
      data-testid="marquee"
      data-marquee-width={rect.width}
      aria-hidden={true}
      className="marquee"
      style={{
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderWidth: `${1 / camera.zoom}px`,
      }}
    />
  );
}
