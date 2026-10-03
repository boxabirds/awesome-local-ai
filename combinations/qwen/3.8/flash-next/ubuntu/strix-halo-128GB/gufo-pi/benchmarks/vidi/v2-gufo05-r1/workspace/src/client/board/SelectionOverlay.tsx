/**
 * What the user sees when things are selected (`sel.*`, design.md "Selection").
 *
 * One thin outline around every selected object, one bounding box around all of
 * them, and eight square handles on that box. It draws from the same ids the board
 * acts on, so what is outlined, what moves and what is deleted can never disagree —
 * which matters most for story 6, where what the user selects is also what gets
 * published to everybody else.
 *
 * It is drawn in **screen** space, over the viewport, rather than inside the scaled
 * world layer: a handle has to stay 8 pixels on the screen at every zoom level
 * (`HANDLE_SIZE_PX`), which an object inside the world layer cannot promise, because
 * the world layer scales everything in it. So world rectangles are converted here,
 * with `worldToScreen`, and the camera is one of its inputs — a selection outline that
 * did not follow the camera would be a lie about where the selection is.
 *
 * The overlay never takes a pointer except on its handles: the board underneath stays
 * clickable through it, so a click on empty space inside the bounding box still pans
 * the board or clears the selection.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { HANDLE_LABELS, type HandleId } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { handlesFor } from '../objects/registry';

export interface SelectionOverlayProps {
  /** The selected ids, in any order. */
  selection: readonly string[];
  /** What the board can draw: an id that is not here draws nothing. */
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  /** Press on a handle: start a resize. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: HandleId): void;
}

/** Which corner or edge of the box a handle sits on, in fractions of it. */
const HANDLE_PLACEMENT: Record<HandleId, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

/** The cursor that says which way a handle drags. */
const HANDLE_CURSOR: Record<HandleId, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** A rectangle in world units, in screen pixels, from the current camera. */
function screenRect(
  camera: Camera,
  world: { x: number; y: number; width: number; height: number },
) {
  const zoom = camera.zoom;
  const point = worldToScreen(camera, { x: world.x, y: world.y });
  return { left: point.x, top: point.y, width: world.width * zoom, height: world.height * zoom };
}

export function SelectionOverlay(props: SelectionOverlayProps) {
  const { selection, snapshot, camera, onHandlePointerDown } = props;

  // Only objects the board can draw are outlined: an id in the document that this app
  // has no component for is not selectable, so it must not be shown as selected.
  const objects = snapshot.filter((object) => selection.includes(object.id));
  if (objects.length === 0) return null;

  // Only the handles every object in the selection agrees to: free text is resized
  // sideways, so as soon as it is part of the selection the top and bottom ones go away.
  const handles = handlesFor(objects);
  const boxes = objects.map((object) => screenRect(camera, objectBounds(object)));
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  const box = { left, top, width: right - left, height: bottom - top };

  return (
    <div className="selection-overlay" data-testid="selection-overlay" aria-hidden="true">
      {boxes.map((rect, index) => (
        <div
          key={objects[index]?.id ?? index}
          className="selection-overlay__item"
          data-testid="selection-outline"
          /* `data-object-id` belongs to the object itself; an outline only points at it,
             and a selector that means "the objects on this board" must not also match
             the decoration drawn over them. */
          data-outline-id={objects[index]?.id}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      ))}
      <div
        className="selection-overlay__box"
        data-testid="selection-box"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      />
      {handles.map((handle) => {
          const place = HANDLE_PLACEMENT[handle];
          return (
            <button
              key={handle}
              type="button"
              className={`selection-handle selection-handle--${handle}`}
              data-testid="selection-handle"
              data-handle={handle}
              // The accessible name a screen reader needs to say which handle this is
              // ("Resize top-left"), as the design asks for.
              aria-label={HANDLE_LABELS[handle]}
              style={{
                left: box.left + box.width * place.x - HANDLE_SIZE_PX / 2,
                top: box.top + box.height * place.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                cursor: HANDLE_CURSOR[handle],
              }}
              onPointerDown={(event) => onHandlePointerDown(event, handle)}
            />
          );
        })}
    </div>
  );
}
