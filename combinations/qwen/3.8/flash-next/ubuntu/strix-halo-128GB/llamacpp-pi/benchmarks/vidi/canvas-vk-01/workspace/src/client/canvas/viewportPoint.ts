import type { Camera, Point } from './camera';
import { screenToWorld } from './camera';

/**
 * Turning a pointer event's client coordinates into board (world) coordinates.
 *
 * The viewport is the board's own coordinate system: everything the camera
 * transform works on is measured from its top-left corner, which is what
 * {@link screenToWorld} expects. Tools need this for every gesture, and doing it
 * here keeps the viewport lookup in one place.
 */

/** The viewport's top-left corner in client coordinates, or zeros when absent. */
export function viewportOrigin(): Point {
  if (typeof document === 'undefined') return { x: 0, y: 0 };
  const element = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
  if (element === null) return { x: 0, y: 0 };
  const rect = element.getBoundingClientRect();
  return { x: rect.left, y: rect.top };
}

/** Client coordinates (a pointer event) to world coordinates. */
export function clientToWorld(camera: Camera, client: Point): Point {
  const origin = viewportOrigin();
  return screenToWorld(camera, { x: client.x - origin.x, y: client.y - origin.y });
}
