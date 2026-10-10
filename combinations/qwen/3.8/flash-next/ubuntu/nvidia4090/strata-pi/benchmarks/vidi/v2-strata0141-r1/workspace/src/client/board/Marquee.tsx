import { useCallback, useEffect, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

/**
 * Shift+drag marquee selection (anchor `sel.marquee_ui`).
 *
 * The rectangle is stored in **world** units, so zooming mid-drag - or zooming
 * between the press and the release - cannot change what it selects. What the
 * pointer reports is screen space, so it is converted with the camera on the way
 * in.
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Idle
 *     Idle --> Marquee : shift pointerdown on empty space
 *     Marquee --> Idle : pointerup selects
 *     Marquee --> Idle : pointercancel or Escape discards, selection unchanged
 * ```
 */
export interface MarqueeApi {
  /** The rectangle in world units, or null when there is no marquee. */
  rect: Rect | null;
  begin(screen: Point): void;
  move(screen: Point): void;
  /** Release: the objects fully inside join the selection. */
  end(): void;
  /** Cancel: the rectangle disappears and the selection is untouched. */
  cancel(): void;
}

export function useMarquee(
  camera: Camera,
  snapshot: readonly ObjectSnapshot[],
  onSelect: (ids: string[]) => void,
): MarqueeApi {
  const [rect, setRect] = useState<Rect | null>(null);
  const anchorRef = useRef<Point | null>(null);
  const rectRef = useRef<Rect | null>(rect);
  rectRef.current = rect;

  // The window listeners and the pointer handlers both need the current camera,
  // snapshot and callback, so they read them through a ref.
  const inputs = useRef({ camera, snapshot, onSelect });
  inputs.current = { camera, snapshot, onSelect };

  const reset = useCallback((): void => {
    anchorRef.current = null;
    setRect(null);
  }, []);

  const begin = useCallback(
    (screen: Point) => {
      const world = screenToWorld(inputs.current.camera, screen);
      anchorRef.current = world;
      setRect({ x: world.x, y: world.y, width: 0, height: 0 });
    },
    // setRect/anchor only: the camera is read through the ref so a drag is not
    // interrupted by a re-render.
    [],
  );

  const move = useCallback((screen: Point) => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    setRect(normalizeRect(anchor, screenToWorld(inputs.current.camera, screen)));
  }, []);

  const end = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    const current = inputs.current;
    // Containment is decided here: `objectsInRect` selects an object only when
    // all four of its edges lie inside (TC-07, TC-32).
    current.onSelect(objectsInRect(current.snapshot, rectRef.current ?? zeroRect(anchor)));
    reset();
  }, [reset]);

  // A marquee is still open while this is true, so Escape cancels the marquee
  // instead of clearing the selection (the sequence in `sel.marquee_ui`).
  const active = rect !== null;

  useEffect(() => {
    if (!active) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      // This listener is attached before the board's own key handling, and
      // stopping immediately keeps `useBoardKeys` from also clearing.
      event.stopImmediatePropagation();
      event.preventDefault();
      reset();
    };
    // On the document, not the window: a keydown reaches `document` before it
    // reaches `useBoardKeys`' window listener, so Escape cancels the marquee and
    // nothing else - the selection is left alone (`sel.marquee_ui`).
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, reset]);

  return { rect, begin, move, end, cancel: reset };
}

const zeroRect = (at: Point): Rect => ({ x: at.x, y: at.y, width: 0, height: 0 });

export interface MarqueeRectProps {
  rect: Rect | null;
  camera: Camera;
}

/** The translucent selection rectangle, drawn in screen space (`sel.marquee_ui`). */
export function MarqueeRect(props: MarqueeRectProps) {
  const { rect, camera } = props;
  if (!rect) {
    return null;
  }
  const corner = worldToScreen(camera, { x: rect.x, y: rect.y });
  const opposite = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  return (
    <div className="marquee-layer" data-testid="marquee-layer" aria-hidden="true">
      <div
        className="marquee-rect"
        data-testid="marquee-rect"
        data-world-width={rect.width}
        data-world-height={rect.height}
        style={{
          left: `${Math.min(corner.x, opposite.x)}px`,
          top: `${Math.min(corner.y, opposite.y)}px`,
          width: `${Math.abs(opposite.x - corner.x)}px`,
          height: `${Math.abs(opposite.y - corner.y)}px`,
        }}
      />
    </div>
  );
}
