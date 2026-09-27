// The marquee (sel.marquee, sel.marquee_ui): Shift + drag on the background.
//
// `useMarquee` owns the gesture — the App starts it from BoardViewport's background
// pointerdown, which only fires for a press on the empty board — and `Marquee`
// draws the light-blue translucent rectangle inside the zoomed world layer.
//
// The rule is CONTAINMENT, not intersection: only objects lying ENTIRELY inside the
// rectangle join the selection, and they are ADDED to it (an empty drag leaves the
// selection exactly as it was). A cancelled marquee (pointercancel or Escape)
// changes nothing.

import { useCallback, useEffect, useRef, useState } from 'react';
import { objectsInRect, type ObjectSnapshot } from '../../shared/board-model';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { DRAG_THRESHOLD_PX } from '../../shared/config';
import { screenToWorld, type Camera } from '../canvas/camera';

/** What the board hands the marquee when the Shift-press lands on empty space. */
export interface MarqueeStart {
  /** The press position, relative to the viewport (the camera's screen origin). */
  point: Point;
  /** Convert a later client (window) point to a viewport-relative point: the
   * viewport is the only thing that knows where it is on the page. */
  toPoint(clientX: number, clientY: number): Point;
  /** The element to capture the pointer on (the viewport). */
  target: Element | null;
  pointerId: number;
}

export interface MarqueeDeps {
  getCamera(): Camera;
  getSnapshot(): readonly ObjectSnapshot[];
  /** Union these ids into the current selection. */
  addToMany(ids: string[]): void;
}

export interface MarqueeApi {
  /** The live rectangle in world units, or null while idle. */
  rect: Rect | null;
  begin(start: MarqueeStart): void;
  /** Abort without changing the selection (pointercancel / Escape). */
  cancel(): void;
  /** True while a marquee drag is in progress (Escape then belongs to it). */
  isActive(): boolean;
}

export function useMarquee(deps: MarqueeDeps): MarqueeApi {
  const ref = useRef(deps);
  ref.current = deps;

  const [rect, setRect] = useState<Rect | null>(null);
  const active = useRef(false);
  const detach = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    active.current = false;
    detach.current?.();
    detach.current = null;
    setRect(null);
  }, []);

  // Clean up if the board unmounts mid-drag.
  useEffect(() => () => detach.current?.(), []);

  const begin = useCallback(
    (start: MarqueeStart) => {
      if (active.current) return;
      active.current = true;
      const startClient = start.point;
      let current = startClient;
      let frame = 0;

      // Keep the pointer coming in even when it leaves the window. The browser
      // releases the capture itself when the pointer is released.
      if (start.target && typeof start.pointerId === 'number') {
        try {
          start.target.setPointerCapture?.(start.pointerId);
        } catch {
          /* jsdom, or a synthetic event without a real pointer */
        }
      }

      // Both corners are derived from the CURRENT camera on every frame, so a zoom
      // or pan during the drag keeps the box under the pointer instead of sliding
      // away from it.
      const compute = (): Rect => {
        const cam = ref.current.getCamera();
        return normalizeRect(screenToWorld(cam, startClient), screenToWorld(cam, current));
      };
      setRect(compute());

      const onMove = (ev: PointerEvent) => {
        current = start.toPoint(ev.clientX, ev.clientY);
        if (frame) return; // one repaint per animation frame
        frame = requestAnimationFrame(() => {
          frame = 0;
          setRect(compute());
        });
      };

      const onUp = (ev: PointerEvent) => {
        current = start.toPoint(ev.clientX, ev.clientY);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        const final = compute();
        const dragPx = Math.hypot(current.x - startClient.x, current.y - startClient.y);
        const ids = dragPx >= DRAG_THRESHOLD_PX ? objectsInRect(ref.current.getSnapshot(), final) : [];
        // Additive, and an empty result leaves the selection unchanged.
        if (ids.length > 0) ref.current.addToMany(ids);
        stop();
      };

      // Escape (or pointercancel) aborts: no selection change at all (TC-22).
      const onCancel = () => stop();
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') stop();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      detach.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        if (frame) cancelAnimationFrame(frame);
      };
    },
    [stop],
  );

  const cancel = useCallback(() => {
    if (active.current) stop();
  }, [stop]);

  return { rect, begin, cancel, isActive: () => active.current };
}

export interface MarqueeProps {
  rect: Rect | null;
  /** Camera zoom: the 1 px border is expressed in world units so it stays a hairline. */
  zoom: number;
}

/** The translucent selection rectangle (sel.marquee_ui: "a light blue translucent
 * rectangle follows the pointer"), drawn in world coordinates inside the world layer. */
export const Marquee = ({ rect, zoom }: MarqueeProps) => {
  if (!rect) return null;
  const border = 1 / (zoom || 1);
  return (
    <div
      data-testid="marquee"
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'rgba(37, 99, 235, 0.12)',
        border: `${border}px solid #2563eb`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    />
  );
};
