// Shift+drag marquee selection: a translucent rectangle in world units
// (zoom changes during the drag are harmless); on release the fully enclosed
// objects are added to the selection.

import { useCallback, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, type Camera } from '../canvas/camera';

export interface MarqueeController {
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
): MarqueeController {
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [rect, setRect] = useState<Rect | null>(null);
  const rectRef = useRef<Rect | null>(null);
  const startRef = useRef<Point | null>(null);

  const set = useCallback((next: Rect | null) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      const p = screenToWorld(cameraRef.current, screen);
      startRef.current = p;
      set({ x: p.x, y: p.y, width: 0, height: 0 });
    },
    [set],
  );

  const move = useCallback(
    (screen: Point) => {
      const start = startRef.current;
      if (!start) return;
      const p = screenToWorld(cameraRef.current, screen);
      set(normalizeRect(start, p));
    },
    [set],
  );

  const end = useCallback(() => {
    const r = rectRef.current;
    startRef.current = null;
    set(null);
    if (!r) return;
    const ids = objectsInRect(snapshotRef.current, r);
    // No objects fully inside: selection unchanged.
    if (ids.length > 0) onSelectRef.current(ids);
  }, [set]);

  const cancel = useCallback(() => {
    startRef.current = null;
    set(null);
  }, [set]);

  return { rect, begin, move, end, cancel };
}

// Rendered as a child of the world layer, so the rectangle is drawn in world
// coordinates; `camera` is accepted for API symmetry.
export function MarqueeRect({
  rect,
  camera: _camera,
}: {
  rect: Rect | null;
  camera: Camera;
}): React.JSX.Element | null {
  if (!rect) return null;
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    />
  );
}
