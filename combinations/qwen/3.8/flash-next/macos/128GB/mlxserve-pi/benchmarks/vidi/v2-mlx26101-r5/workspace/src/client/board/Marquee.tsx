/**
 * The rubber band: pull a rectangle out of the board and everything under it is selected.
 *
 * It is a board gesture rather than an object one — the rectangle is drawn over everything on the
 * board, and it decides its selection from the whole board snapshot. The board viewport hands it the
 * pointer when a press starts with Shift held down on empty board space; without Shift that same drag
 * pans the camera, and the one gesture that *adds* to a selection is exactly the gesture panning must
 * not claim.
 *
 * Nothing is written to the document while it is being pulled. The rectangle is local, the selection
 * is local, and the only thing that leaves this file is a list of ids handed to the selection when the
 * pointer comes up.
 *
 * The rectangle is kept in **world units**. The screen is where the pointer is, but the screen is also
 * what a trackpad pinch changes underneath the pointer mid-drag: stored in world units, a change of
 * zoom moves the rectangle along with the board it was pulled over instead of leaving it behind.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { objectsInRect, objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { hitTestObject } from '../objects/registry';

export interface Marquee {
  /** Where the rectangle is, in world units; null when none is being pulled. */
  rect: Rect | null;
  /** The pointer went down on empty board space with Shift held, in screen coordinates. */
  begin(screen: Point): void;
  /** The pointer moved, in screen coordinates. */
  move(screen: Point): void;
  /** The pointer came up: what is inside the rectangle joins the selection. */
  end(): void;
  /** Escape, or a pointer the system took away: the selection stays exactly as it was. */
  cancel(): void;
}

export interface MarqueeOptions {
  /** Screen to world at the ends of the drag, and world to screen to draw it. */
  camera: Camera;
  /** The board, because what is inside the rectangle is a question about the whole board. */
  snapshot: readonly ObjectSnapshot[];
  /** What the selection grows by when the rectangle ends. */
  onSelect: (ids: string[]) => void;
}

const finite = (point: Point): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/** The middle of an object's own box, for asking its type whether it is there. */
const centreOf = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export function useMarquee({ camera, snapshot, onSelect }: MarqueeOptions): Marquee {
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  /** Where the press started and where the pointer last was, both in world units. */
  const anchorRef = useRef<Point | null>(null);
  const lastRef = useRef<Point | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);

  const stop = useCallback(() => {
    anchorRef.current = null;
    lastRef.current = null;
    setRect(null);
  }, []);

  const begin = useCallback((screen: Point) => {
    if (!finite(screen)) return;
    const anchor = screenToWorld(cameraRef.current, screen);
    anchorRef.current = anchor;
    lastRef.current = anchor;
    setRect({ x: anchor.x, y: anchor.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    const anchor = anchorRef.current;
    if (!anchor || !finite(screen)) return;
    const point = screenToWorld(cameraRef.current, screen);
    lastRef.current = point;
    setRect(normalizeRect(anchor, point));
  }, []);

  const end = useCallback(() => {
    // Worked out from the two points rather than from the state: `end` is called from an event
    // handler, and the rectangle the pointer last described is what the selection is about.
    const anchor = anchorRef.current;
    const last = lastRef.current;
    if (!anchor || !last) return;
    const box = normalizeRect(anchor, last);
    // Wholly inside, or not at all — the rule the PRD asks for, in the world units objects live in.
    const inside = objectsInRect(snapshotRef.current, box).filter((id) => {
      const object = snapshotRef.current.find((candidate) => candidate.id === id);
      // The rectangle already said the object is inside it; the type's own hit test is what says the
      // object can be picked up at all. A type this build cannot draw answers "nowhere", and
      // something nobody can see must not be silently dragged around by a marquee.
      return object !== undefined && hitTestObject(object, centreOf(objectBounds(object)));
    });
    selectRef.current(inside);
    stop();
  }, [stop]);

  // Escape ends the rectangle without touching the selection, and ends it before the board sees the
  // key, so that one key does not do two things at once.
  useEffect(() => {
    if (rect === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      stop();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [rect, stop]);

  return { rect, begin, move, end, cancel: stop };
}

export interface MarqueeRectProps {
  /** The rectangle in world units, or null when nobody is pulling one. */
  rect: Rect | null;
  /** To put that rectangle on the screen, which is where the pointer is. */
  camera: Camera;
}

/**
 * The rectangle itself: a dashed line and a faint fill, over the board and transparent to the pointer.
 *
 * It is drawn in screen space from a world-unit rectangle, so it is the one place in the marquee that
 * has to know the zoom — and the reason the rectangle is stored in world units in the first place.
 */
export function MarqueeRect({ rect, camera }: MarqueeRectProps): React.JSX.Element | null {
  if (rect === null) return null;
  const corner = worldToScreen(camera, { x: rect.x, y: rect.y });
  const style: React.CSSProperties = {
    left: `${corner.x}px`,
    top: `${corner.y}px`,
    width: `${Math.max(0, rect.width * camera.zoom)}px`,
    height: `${Math.max(0, rect.height * camera.zoom)}px`,
  };
  return (
    <div
      aria-hidden="true"
      className="board-marquee"
      data-testid="marquee"
      data-x={rect.x}
      data-y={rect.y}
      data-width={rect.width}
      data-height={rect.height}
      style={style}
    />
  );
}
