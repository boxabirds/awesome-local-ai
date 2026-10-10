import type { Point } from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import type { BoardSurface } from '../canvas/BoardViewport';

/**
 * Where a `window` pointer event landed, for a tool that listens outside the
 * board surface (anchors `shape.tool`, `connector.tool`).
 *
 * Story 10's two tools install their listeners on `window` in the capture phase,
 * so that a drag started by a tool cannot be answered by the board's own pan,
 * marquee or object gesture at the same time. Everything they are given is a
 * window coordinate, and the camera is told in surface coordinates - so the
 * surface's own offset is subtracted here, in one place, before the camera
 * converts it to world.
 */

/** The event's position within the board surface. */
export function surfacePointOf(
  event: { readonly clientX: number; readonly clientY: number },
  surface: BoardSurface | null,
): Point {
  const origin = surface?.origin ?? { x: 0, y: 0 };
  return { x: event.clientX - origin.x, y: event.clientY - origin.y };
}

/**
 * The event's position in world units, or `null` when the board has not published
 * its surface yet. A tool that cannot say where a click is must not guess: it does
 * nothing, and creates nothing.
 */
export function worldPointOf(
  event: { readonly clientX: number; readonly clientY: number },
  surface: BoardSurface | null,
): Point | null {
  if (!surface) {
    return null;
  }
  const camera = surface.camera;
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y) || !Number.isFinite(camera.zoom)) {
    return null; // a camera that is not a number cannot place a shape
  }
  return screenToWorld(camera, surfacePointOf(event, surface));
}

/** Is this event aimed at board chrome (a toolbar, the zoom controls, the share panel)? */
export function isBoardChrome(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-board-chrome]') !== null;
}

/** Is this event aimed at something being typed into? */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  );
}
