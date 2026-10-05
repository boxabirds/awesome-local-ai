/**
 * Shift+drag box selection (`sel.marquee`).
 *
 * The rectangle is kept in *board* units, not pixels: the zoom can change under a drag (a
 * trackpad twitch, somebody else's keyboard shortcut) and a box that meant "these objects"
 * then still means the same objects. Only the drawing converts it back to screen space.
 *
 * What the box selects is `objectsInRect`'s entirely-inside rule, and what it does with
 * them is *add* to the selection — a box is drawn around things you already picked, and a
 * marquee that caught nothing leaves the selection exactly as it was.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

export interface MarqueeControls {
  /** The box being dragged, in board units, or null when there is no marquee. */
  rect: Rect | null;
  /** Shift+pointerdown on empty board space. */
  begin(screen: Point): void;
  /** The pointer travelling with the button still held. */
  move(screen: Point): void;
  /** Release: the objects inside are added to the selection. */
  end(): void;
  /** Escape or pointercancel: throw the box away and change nothing. */
  cancel(): void;
}

const NO_BOX: Rect | null = null;

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void
): MarqueeControls {
  const [rect, setRect] = useState<Rect | null>(NO_BOX);
  const rectRef = useRef<Rect | null>(NO_BOX);
  const originRef = useRef<Point | null>(null);
  const activeRef = useRef(false);

  // The latest values, for callbacks that are registered once.
  const latest = useRef({ camera, snapshot, onSelect });
  latest.current = { camera, snapshot, onSelect };

  const write = (next: Rect | null): void => {
    rectRef.current = next;
    setRect(next);
  };

  const begin = useCallback((screen: Point) => {
    activeRef.current = true;
    originRef.current = screenToWorld(latest.current.camera, screen);
    write({ x: originRef.current.x, y: originRef.current.y, width: 0, height: 0 });
  }, []);

  const move = useCallback((screen: Point) => {
    const origin = originRef.current;
    if (!activeRef.current || !origin) return;
    write(normalizeRect(origin, screenToWorld(latest.current.camera, screen)));
  }, []);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    originRef.current = null;
    const box = rectRef.current;
    write(NO_BOX);
    // A press without a drag is not a marquee: it selected nothing, so it changes nothing.
    if (!box || box.width <= 0 || box.height <= 0) return;
    const ids = objectsInRect(latest.current.snapshot, box);
    if (ids.length === 0) return;
    latest.current.onSelect(ids);
  }, []);

  const cancel = useCallback(() => {
    activeRef.current = false;
    originRef.current = null;
    write(NO_BOX);
  }, []);

  /* Escape throws the box away rather than clearing the selection, so while a marquee is
     running this key is not the board's: the capture-phase listener below stops the event
     before the board-wide keys see it (`sel.clear`, `sel.marquee`). */
  useEffect(() => {
    if (!rect) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [rect, cancel]);

  return { rect, begin, move, end, cancel };
}

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/** The translucent rectangle itself, drawn in screen space above the board. */
export function MarqueeRect(props: MarqueeRectProps): JSX.Element | null {
  const { rect, camera } = props;
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const corner = worldToScreen(camera, { x: rect.x, y: rect.y });
  return (
    <div
      className="vidi6-marquee"
      data-vidi6="marquee"
      data-testid="marquee"
      aria-hidden="true"
      style={{
        left: corner.x,
        top: corner.y,
        width: rect.width * camera.zoom,
        height: rect.height * camera.zoom
      }}
    />
  );
}
