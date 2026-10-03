// The two small things the story 10 tools need to share: where a pointer event is on the
// board, and the layer that covers it.
//
// Both tools work in screen coordinates for their preview (a preview is a screen thing: it
// is 2 px thick and the same size whatever the zoom) and in world coordinates for what they
// write, so both points are wanted from every event and the conversion is one step at a time:
// `localPoint` here, `screenToWorld` on the result, with the camera the tool is already
// holding. The surface is the board's own element — the same one `BoardViewport` measures for
// its `toLocal`, so a tool's idea of "where did I press" and the viewport's idea of it cannot
// drift apart.

import type { Point } from '../canvas/camera';

/** The point of an event relative to the board surface, in CSS pixels. */
export function localPoint(
  surface: HTMLElement | null,
  e: { clientX: number; clientY: number },
): Point {
  if (!surface) return { x: e.clientX, y: e.clientY };
  const rect = surface.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
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
