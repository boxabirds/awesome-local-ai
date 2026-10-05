/**
 * The rectangle that selects.
 *
 * A drag across empty board space draws a rectangle, and the objects *fully inside* it are selected
 * when the pointer is let go. Two things about that are easy to get wrong and are the reason this file
 * is separate rather than a few more lines in the viewport:
 *
 * - **The rectangle is stored in board units, not screen units.** The viewport can be zoomed during a
 *   drag — with the wheel, or by the other person who shares this board and is zooming at the same
 *   time. A rectangle held in pixels would then be a different rectangle in the board, and the objects
 *   it selects would change under the person drawing it. Held in board units, the box on the screen is
 *   a drawing of a fixed place, which is what it looks like it is.
 * - **Escape and pointercancel must not select.** A rectangle drawn and then given up is not a
 *   selection request, and the selection the person already had is left alone.
 *
 * Escape is swallowed here, on the document in the capture phase, so that the board's Escape — the one
 * that empties the selection — never sees the keystroke that was meant for the rectangle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectsInRect } from '../../shared/board-model';
import type { Point, Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';

export interface Marquee {
  /** The rectangle as it is drawn now, in board units; null when no marquee is in flight. */
  rect: Rect | null;
  /** Whether a marquee is in flight, which is a question the viewport asks before it pans. */
  active: boolean;
  /** Pointer down on empty space with Shift held. */
  begin(screen: Point, pointerId?: number): void;
  move(screen: Point): void;
  /** Pointer released: whatever is fully inside is selected. */
  end(): void;
  /** Given up: Escape or pointercancel. The selection is left as it was. */
  cancel(): void;
}

/** The ids the rectangle would select if it were released now. */
export function marqueeSelection(snapshot: readonly ObjectSnapshot[], rect: Rect | null): string[] {
  if (rect === null) return [];
  return objectsInRect(snapshot, rect);
}

interface Corners {
  from: Point;
  to: Point;
  pointerId: number;
}

/**
 * The marquee's state and its listeners.
 *
 * `onSelect` is called once, at the end, with the ids it landed on — including an empty list, which
 * the caller passes on as an additive select and which therefore leaves the selection as it was. The
 * hook does not know what a selection is; it knows where the rectangle is.
 */
export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): Marquee {
  const [corners, setCorners] = useState<Corners | null>(null);

  // Fresh values for listeners that outlive the render that installed them.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const current = useRef<Corners | null>(null);
  const listeners = useRef<{
    move(event: PointerEvent): void;
    up(): void;
    taken(): void;
    key(event: KeyboardEvent): void;
  } | null>(null);

  const world = (screen: Point): Point => screenToWorld(cameraRef.current, screen);

  const finish = useCallback((): void => {
    const installed = listeners.current;
    if (installed !== null) {
      window.removeEventListener('pointermove', installed.move);
      window.removeEventListener('pointerup', installed.up);
      window.removeEventListener('pointercancel', installed.taken);
      document.removeEventListener('keydown', installed.key, true);
      listeners.current = null;
    }
    current.current = null;
    setCorners(null);
  }, []);

  const release = useCallback(
    (selects: boolean): void => {
      const box = current.current;
      const rect = box === null ? null : normalizeRect(box.from, box.to);
      // Read the board at the moment of release, not the moment the drag began: an object created
      // during the drag is something the person could have seen they were inside of.
      const ids = selects ? marqueeSelection(snapshotRef.current, rect) : [];
      finish();
      if (selects) selectRef.current(ids);
    },
    [finish],
  );

  const install = useCallback((): void => {
    if (listeners.current !== null) return;
    const move = (event: PointerEvent): void => {
      const box = current.current;
      // Only the pointer that began the rectangle may draw it; a second finger on a trackpad or a
      // stray pen does not get to move it.
      if (box === null || event.pointerId !== box.pointerId) return;
      current.current = { ...box, to: world({ x: event.clientX, y: event.clientY }) };
      setCorners(current.current);
    };
    const up = (): void => {
      release(true);
    };
    // The pointer taken away is not a selection. A rectangle that the person let go of is a rectangle
    // they meant; one that a system gesture or a lost window took from them is a question that was
    // never answered, and answering it by choosing objects is how a board ends up with six notes
    // selected that nobody asked for.
    const taken = (): void => {
      release(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The rectangle's Escape, and nobody else's: stopping it here is what keeps the board's Escape
      // — which empties the whole selection — from firing on the same keystroke.
      event.stopPropagation();
      event.preventDefault();
      release(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', taken);
    document.addEventListener('keydown', key, true);
    listeners.current = { move, up, taken, key };
  }, [release]);

  const begin = useCallback(
    (screen: Point, pointerId = 0): void => {
      const point = world(screen);
      current.current = { from: point, to: point, pointerId };
      setCorners(current.current);
      install();
    },
    [install],
  );

  const move = useCallback(
    (screen: Point): void => {
      const box = current.current;
      if (box === null) return;
      current.current = { ...box, to: world(screen) };
      setCorners(current.current);
    },
    [],
  );

  const end = useCallback((): void => {
    if (current.current === null) return;
    release(true);
  }, [release]);

  const cancel = useCallback((): void => {
    if (current.current === null) return;
    release(false);
  }, [release]);

  // A marquee that is still being drawn when this screen goes away draws nothing, and must leave no
  // listener behind.
  useEffect(() => finish, [finish]);

  return {
    rect: corners === null ? null : normalizeRect(corners.from, corners.to),
    active: corners !== null,
    begin,
    move,
    end,
    cancel,
  };
}

/**
 * The rectangle itself, drawn over the board.
 *
 * It is drawn in screen units from a rectangle held in board units, which is the difference between a
 * selection box that tracks the board while a wheel scrolls and one that does not. It is deliberately
 * not `aria-hidden`: the box is a thing the person is looking at, and a screen reader user is told what
 * was selected when it finishes, not while it is being drawn.
 */
export function MarqueeRect({ rect, camera }: { rect: Rect | null; camera: Camera }): JSX.Element | null {
  if (rect === null || rect.width === 0 || rect.height === 0) return null;
  const origin = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="marquee"
      data-testid="marquee"
      style={{
        left: `${origin.x}px`,
        top: `${origin.y}px`,
        width: `${rect.width * camera.zoom}px`,
        height: `${rect.height * camera.zoom}px`,
      }}
    />
  );
}

/** The event the viewport hands a marquee, kept loose so tests can hand a plain pointer event. */
export type MarqueeEvent = PointerEvent | ReactPointerEvent;
