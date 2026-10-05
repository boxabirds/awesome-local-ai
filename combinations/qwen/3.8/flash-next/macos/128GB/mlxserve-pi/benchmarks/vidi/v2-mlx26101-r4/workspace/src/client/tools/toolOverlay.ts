/**
 * The sheet a drawing tool stands on.
 *
 * A tool is a transparent layer laid over the board for as long as it is armed. The layer takes the pointer —
 * which is the whole of how a shape drawn across a sticky note leaves the note where it is: the press is
 * never handed to the note — and it needs one conversion done the same way every time: *where on the board is
 * this pointer?* One answer, in one place, because two tools each subtracting the window's own position from
 * a client coordinate is two tools that put shapes two handfuls of pixels apart from where they were drawn.
 *
 * The conversion is `screenToWorld` after taking the sheet's own place on the screen out, which is the same
 * way the board's own gestures do it. The sheet is not scrolled or scaled, so its top-left is the board's
 * viewport origin; the camera then turns a screen pixel into a board unit.
 */
import type { RefObject } from 'react';
import type { CSSProperties } from 'react';

import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';

/** The sheet itself: full board, above the objects, and the pointer's destination while a tool is armed. */
export const toolOverlayStyle: CSSProperties = Object.freeze({
  position: 'absolute',
  inset: 0,
  zIndex: 6,
  cursor: 'crosshair',
  touchAction: 'none',
  userSelect: 'none',
});

/** The sheet's drawing layer: screen units, above the board, and nothing ever lands on it. */
export const toolOverlaySvgStyle: CSSProperties = Object.freeze({
  position: 'absolute',
  inset: 0,
  overflow: 'visible',
  pointerEvents: 'none',
});

/**
 * A pointer event over the sheet, in board units.
 *
 * The sheet's rectangle is asked for at the moment of the event rather than remembered, because a sheet is
 * moved by the browser (a window resize, a toolbar appearing) while a drag is in flight, and a remembered
 * origin turns into a shape that is not where the pointer was.
 */
export function worldOfOverlay(
  overlay: RefObject<HTMLElement | null>,
  camera: Camera,
  event: { clientX: number; clientY: number },
): Point {
  const rect = overlay.current?.getBoundingClientRect();
  return screenToWorld(camera, { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) });
}
