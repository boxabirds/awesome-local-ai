// Marquee selection (`sel.marquee_ui`).
//
// Shift plus a drag on empty board space draws a rectangle and selects what fell
// inside it. Two things about it are rules rather than details:
//
//   - The rectangle is kept in world units, so zooming with the trackpad in the middle
//     of a drag does not move the box around under the pointer.
//   - A rectangle selects an object only when the object lies wholly inside it. One
//     that is half in is left out, which is what makes a box that overshoots a note by
//     a hair predictable instead of apparently random.
//
// What the drag selects is *added* to what was already selected; a drag that catches
// nothing changes nothing.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { BoardObject } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import type { Camera, Point, Size } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

export interface MarqueeState {
  /** The box being drawn, in world units; null when no marquee is happening. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Release: the ids wholly inside go to `onSelect`. */
  end(): void;
  /** Escape or pointercancel: the box goes away, the selection stays as it was. */
  cancel(): void;
}

/**
 * The box a shift-drag draws. `onSelect` receives the ids wholly inside the box on
 * release — the ids, not the box: what a set of ids means for the selection is the
 * selection's business (`useSelection`), not the gesture's.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly BoardObject[],
  onSelect: (ids: readonly string[]) => void,
): MarqueeState {
  const [rect, setRect] = useState<Rect | null>(null);

  // The newest camera and snapshot, so the callbacks below can stay stable: a drag
  // that started two renders ago still ends against what is on the screen now.
  const live = useRef({ camera, snapshot, onSelect });
  live.current = { camera, snapshot, onSelect };

  const origin = useRef<Point | null>(null);
  // The box as the last move left it, which is what `end` selects with: React has not
  // necessarily re-rendered since that move.
  const box = useRef<Rect | null>(null);

  const begin = useCallback((screen: Point): void => {
    origin.current = screenToWorld(live.current.camera, screen);
    box.current = null;
    setRect(null);
  }, []);

  const move = useCallback((screen: Point): void => {
    const start = origin.current;
    if (!start) return;
    const next = normalizeRect(start, screenToWorld(live.current.camera, screen));
    box.current = next;
    setRect(next);
  }, []);

  const end = useCallback((): void => {
    const caught = box.current;
    origin.current = null;
    box.current = null;
    setRect(null);
    if (!caught) return;
    live.current.onSelect(objectsInRect(live.current.snapshot, caught));
  }, []);

  const cancel = useCallback((): void => {
    origin.current = null;
    box.current = null;
    setRect(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

/** A rectangle in world units, placed on the screen by the camera. */
export function screenOf(rect: Rect, camera: Camera): Rect & Size {
  const corner = worldToScreen(camera, { x: rect.x, y: rect.y });
  return { x: corner.x, y: corner.y, width: rect.width * camera.zoom, height: rect.height * camera.zoom };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/** The translucent box itself, drawn in screen space above the board. */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): ReactNode {
  if (!rect) return null;
  const where = screenOf(rect, camera);
  return (
    <div
      data-testid="marquee"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: where.x,
        top: where.y,
        width: where.width,
        height: where.height,
        boxSizing: 'border-box',
        border: '1px solid #2f6feb',
        backgroundColor: 'rgba(47, 111, 235, 0.12)',
        // The board keeps every pointer event: the box is only a picture of a drag.
        pointerEvents: 'none',
      }}
    />
  );
}
