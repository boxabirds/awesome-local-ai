import { useEffect, useRef } from "react";
import type { Point } from "../canvas/camera";

/**
 * The pointer plumbing the Shape and Connector tools share.
 *
 * Both tools take the board's pointer for as long as their tool is active, so
 * their listeners are attached to `document` in the **capture** phase — the same
 * trick story 9's Text tool uses on the viewport element, one level further out
 * because these tools answer presses on top of existing objects too. Claiming a
 * press stops it before it reaches the board: no pan, no marquee, no select, no
 * double-click.
 *
 * A press that a tool does not claim (on a control, or empty board space in the
 * Connector tool) is left alone, and the board behaves exactly as it does in
 * Select mode.
 */

export interface CaptureGestureHandlers {
  /**
   * Return true to claim the press — the board sees nothing of it, and the
   * matching move/up go to this tool.
   */
  onPointerDown?(event: PointerEvent, point: Point): boolean;
  onPointerMove?(event: PointerEvent, point: Point): void;
  onPointerUp?(event: PointerEvent, point: Point): void;
  onPointerCancel?(event: PointerEvent): void;
}

/** A press on a control belongs to the control, not to the board. */
export function isBoardControl(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('textarea, input, select, button, [contenteditable="true"]') !== null
  );
}

/** Only the primary button is a board gesture; right/middle clicks are the browser's. */
export function isPrimaryPointer(event: PointerEvent): boolean {
  return event.pointerType !== "mouse" || event.button === 0;
}

export function useCaptureGestures(active: boolean, handlers: CaptureGestureHandlers): void {
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!active) return;

    /** The press this tool claimed, so its move/up go to the same place. */
    let claimed: number | null = null;

    const pointOf = (event: { clientX: number; clientY: number }): Point => ({
      x: event.clientX,
      y: event.clientY,
    });

    const onPointerDown = (event: PointerEvent) => {
      if (!isPrimaryPointer(event)) return;
      const claimedNow = latest.current.onPointerDown?.(event, pointOf(event)) === true;
      if (!claimedNow) return;
      claimed = event.pointerId;
      event.preventDefault();
      event.stopPropagation();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (claimed === null || claimed !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onPointerMove?.(event, pointOf(event));
    };

    const onPointerUp = (event: PointerEvent) => {
      if (claimed === null || claimed !== event.pointerId) return;
      claimed = null;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onPointerUp?.(event, pointOf(event));
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (claimed === null || claimed !== event.pointerId) return;
      claimed = null;
      latest.current.onPointerCancel?.(event);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
    return () => {
      claimed = null;
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
    };
  }, [active]);
}
