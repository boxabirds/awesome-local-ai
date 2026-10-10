import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';

import { objectsInRect } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect } from '../../shared/geometry';
import type { Point, Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

export interface Marquee {
  /** The rectangle being dragged, in world units; `null` between gestures. */
  readonly rect: Rect | null;
  /** Shift+pointerdown on empty board space, in screen pixels. */
  begin(screen: Point): void;
  /** The pointer moved; the rectangle follows it. */
  move(screen: Point): void;
  /** The pointer came up: whatever is inside is selected (additively). */
  end(): void;
  /** The gesture was interrupted: the selection is left as it was. */
  cancel(): void;
}

/**
 * Drag a rectangle around a group of objects (`sel.marquee_ui`), and get the ids
 * of the objects it encloses.
 *
 * The rectangle is kept in world units, because the board's objects live in world
 * units: zoom or pan the camera mid-drag and the box still means the same place
 * on the board, and containment is decided against the geometry the board stores
 * rather than against pixels that change when somebody else zooms.
 *
 * Which ids the marquee selects is one question with one answer, in
 * `objectsInRect`: an object is selected when the rectangle covers *all* of it.
 * An object half inside stays where it is — half-in is not "which one did I mean"
 * — and ids already selected survive, because the marquee adds (`end` hands the
 * ids to `setMany(ids, additive=true)`).
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [rect, setRect] = useState<Rect | null>(null);
  // The same rectangle, readable without waiting for React to commit: the pointer
  // can come up in the same tick as the move that drew the box.
  const rectRef = useRef<Rect | null>(null);
  // Where the drag started, in world units, so the box has an anchor to grow from.
  const anchorRef = useRef<Point | null>(null);
  // Newest values, so nothing needs re-attaching and no closure is stale.
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };

  const draw = (box: Rect | null): void => {
    rectRef.current = box;
    setRect(box);
  };

  const begin = useCallback((screen: Point): void => {
    anchorRef.current = screenToWorld(latest.current.camera, screen);
    // Nothing is drawn, and nothing is selected, until the box has an area: a
    // shift-click on empty space stays inert rather than selecting the world.
    draw(null);
  }, []);

  const move = useCallback((screen: Point): void => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    draw(normalizeRect(anchor, screenToWorld(latest.current.camera, screen)));
  }, []);

  const end = useCallback((): void => {
    const box = rectRef.current;
    anchorRef.current = null;
    draw(null);
    if (!box) return;
    latest.current.onSelect(objectsInRect(latest.current.snapshot, box));
  }, []);

  const cancel = useCallback((): void => {
    anchorRef.current = null;
    draw(null);
  }, []);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  readonly rect: Rect | null;
  readonly camera: Camera;
}

/**
 * The marquee rectangle itself, drawn in screen space: a box in world units would
 * grow a thicker border as the board zooms in, and a border is not what a person
 * is looking at — the objects they are enclosing are.
 *
 * It is decoration, not a control (`aria-hidden`): the keyboard does this work
 * instead (Ctrl/Cmd+A, then arrows), and a second tab stop around a drag would be
 * a trap.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): JSX.Element | null {
  if (!rect) return null;
  const from = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="marquee-rect"
      data-testid="marquee-rect"
      aria-hidden="true"
      style={{
        left: `${from.x}px`,
        top: `${from.y}px`,
        width: `${rect.width * camera.zoom}px`,
        height: `${rect.height * camera.zoom}px`,
      }}
    />
  );
}
