/**
 * Marquee selection (story 7).
 *
 * Shift+drag on an empty part of the board draws a translucent rectangle; when
 * the button is released, everything *entirely* inside it joins the selection.
 * An object that only touches the edge from outside is not selected, so a
 * rectangle that is too small to hold a sticky note selects nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import { isFinitePointValue, normalizeRect } from '../../shared/geometry';
import type { Point, Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { SELECTION_COLOR } from '../../shared/config';

export interface Marquee {
  /** The rectangle being dragged, in world units, or null when idle. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Release. The final pointer position is authoritative when given. */
  end(screen?: Point): void;
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const originRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(null);

  const reset = useCallback(() => {
    originRef.current = null;
    rectRef.current = null;
    setRect(null);
  }, []);

  const begin = useCallback((screen: Point) => {
    if (!isFinitePointValue(screen)) return;
    const origin = screenToWorld(cameraRef.current, screen);
    originRef.current = origin;
    const zero = { x: origin.x, y: origin.y, width: 0, height: 0 };
    rectRef.current = zero;
    setRect(zero);
  }, []);

  const move = useCallback((screen: Point) => {
    const origin = originRef.current;
    if (!origin || !isFinitePointValue(screen)) return;
    const next = normalizeRect(origin, screenToWorld(cameraRef.current, screen));
    rectRef.current = next;
    setRect(next);
  }, []);

  const end = useCallback((screen?: Point) => {
    const origin = originRef.current;
    if (origin && screen && isFinitePointValue(screen)) {
      rectRef.current = normalizeRect(origin, screenToWorld(cameraRef.current, screen));
    }
    const dragged = rectRef.current;
    if (!dragged || !origin) {
      reset();
      return;
    }
    // A rectangle with no area is a click on empty space, not a marquee.
    if (dragged.width > 0 && dragged.height > 0) {
      const ids = objectsInRect(snapshotRef.current, dragged);
      if (ids.length > 0) onSelectRef.current(ids);
    }
    reset();
  }, [reset]);

  // Escape cancels the drag and leaves the selection as it was. This listener is
  // only mounted while a marquee is in flight, and it runs before the board's
  // own keyboard handler so the selection is not cleared as well.
  const active = rect !== null;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      reset();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, reset]);

  return { rect, begin, move, end, cancel: reset };
}

/** The translucent rectangle itself, drawn in screen space over the board. */
export function MarqueeRect({ rect, camera }: { rect: Rect | null; camera: Camera }) {
  if (!rect) return null;
  const topLeft = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: topLeft.x,
        top: topLeft.y,
        width: Math.max(0, rect.width * camera.zoom),
        height: Math.max(0, rect.height * camera.zoom),
        boxSizing: 'border-box',
        backgroundColor: 'rgba(25, 118, 210, 0.12)',
        border: `1px solid ${SELECTION_COLOR}`,
        pointerEvents: 'none',
      }}
    />
  );
}
