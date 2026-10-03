// The few small things the board's drawing tools need to share (stories 10 and 11): where a
// pointer event is on the board, how far a wheel turned, and the layer that covers it.
//
// Both tools work in screen coordinates for their preview (a preview is a screen thing: it
// is 2 px thick and the same size whatever the zoom) and in world coordinates for what they
// write, so both points are wanted from every event and the conversion is one step at a time:
// `localPoint` here, `screenToWorld` on the result, with the camera the tool is already
// holding. The surface is the board's own element — the same one `BoardViewport` measures for
// its `toLocal`, so a tool's idea of "where did I press" and the viewport's idea of it cannot
// drift apart.
//
// `wheelInputFromEvent` is the same argument one event later: a wheel event belongs to the
// element under the pointer, which while a tool is held is the tool's layer and not the board,
// so the board and the layer above it have to measure a wheel turn the same way or holding a
// pen would change what a scroll does.

import type { Point } from '../canvas/camera';
import type { WheelInput } from '../canvas/useCamera';

/** The point of an event relative to the board surface, in CSS pixels. */
export function localPoint(
  surface: HTMLElement | null,
  e: { clientX: number; clientY: number },
): Point {
  if (!surface) return { x: e.clientX, y: e.clientY };
  const rect = surface.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

/** A wheel line unit, in CSS pixels: what Firefox reports a mouse wheel notch as. */
const PIXELS_PER_LINE = 16;

/**
 * One wheel delta in CSS pixels, whatever unit the browser chose: a mouse wheel in Firefox
 * arrives in lines, a page scroll in pages, and a trackpad in pixels. The board scrolls the same
 * distance for a notch wherever it came from, which is why the conversion is done once here
 * rather than in each place a wheel is heard (board.navigate).
 */
export function wheelPixels(delta: number, mode: number, axisPx: number): number {
  if (mode === 1) return delta * PIXELS_PER_LINE; // DOM_DELTA_LINE
  if (mode === 2) return delta * axisPx; // DOM_DELTA_PAGE
  return delta; // DOM_DELTA_PIXEL
}

/**
 * A wheel event as the camera takes it. Both the board surface and a tool layer over it need
 * this: a wheel event is dispatched to the element under the pointer and then bubbles to its
 * ancestors, so a tool that covers the board is what the wheel is really over, and forwarding
 * the event in the camera's own words is what keeps the board navigable while a pen, a shape or
 * an arrow is being held (pen.navigation).
 */
export function wheelInputFromEvent(
  surface: HTMLElement | null,
  e: WheelEvent,
): WheelInput {
  const axis = surface?.clientWidth || window.innerWidth;
  const height = surface?.clientHeight || window.innerHeight;
  return {
    deltaX: wheelPixels(e.deltaX, e.deltaMode, axis),
    deltaY: wheelPixels(e.deltaY, e.deltaMode, height),
    ctrlOrMeta: e.ctrlKey || e.metaKey,
    point: localPoint(surface, e),
  };
}

/**
 * A full-window layer for a tool in progress: it takes pointer events only while the tool
 * is held, and nothing in it is focusable or announced — what it shows is not real yet.
 * No z-index: it belongs above the world layer (which has none) and below the rail, the
 * selection bar and the zoom controls, which all out-rank it on purpose. The rail has to
 * stay clickable while a tool is held, because that is how a person puts the tool down.
 */
export function toolLayerStyle(active: boolean, cursor: string) {
  return {
    position: 'fixed' as const,
    inset: 0,
    pointerEvents: active ? ('auto' as const) : ('none' as const),
    cursor,
  };
}
