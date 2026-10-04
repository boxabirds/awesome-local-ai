import type { JSX } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds, selectionBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLES, HANDLE_POSITION, type Handle } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType, type ObjectPointerEvent } from '../objects/registry';

export interface SelectionOverlayProps {
  /** What this user has selected. */
  ids: ReadonlySet<string>;
  /** The board's objects, in draw order: the outlines and the box are drawn from these. */
  snapshot: readonly ObjectSnapshot[];
  /** The camera, whose zoom the handles are divided by so they keep their screen size. */
  camera: Camera;
  /** A press on a handle: the transform gesture takes it from here. */
  onHandlePointerDown(event: ObjectPointerEvent, handle: Handle): void;
}

/** Where a handle sits on a box, in world units. */
function handlePoint(box: { x: number; y: number; width: number; height: number }, handle: Handle) {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const middleX = box.x + box.width / 2;
  const middleY = box.y + box.height / 2;
  switch (handle) {
    case 'nw':
      return { x: box.x, y: box.y };
    case 'n':
      return { x: middleX, y: box.y };
    case 'ne':
      return { x: right, y: box.y };
    case 'e':
      return { x: right, y: middleY };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: middleX, y: bottom };
    case 'sw':
      return { x: box.x, y: bottom };
    case 'w':
      return { x: box.x, y: middleY };
  }
}

/** The cursor a handle asks for, so the mouse says what the drag would do. */
const HANDLE_CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/**
 * What this user's selection looks like on the board: an outline around every selected object,
 * a dashed box around all of them, and eight handles to resize the whole lot at once.
 *
 * It draws; it decides nothing. The outlines come from the selection, and the box and the handles
 * from the objects themselves - there is no stored "selection box" to get out of step with the
 * objects inside it, which is why a peer moving one of your selected notes moves your handles
 * with it, and why nothing has to be told to catch up.
 *
 * Everything is placed in world units but *sized* in screen pixels, by dividing by the zoom: a
 * handle is HANDLE_SIZE_PX across whether the board is at 10% or 400%, because a handle you
 * cannot hit with a mouse is not a control at all. The overlay lies over the objects and lets
 * presses through, except on the handles themselves.
 *
 * Handles are shown only when at least one selected object can be resized - a type that has no
 * size to change has no business offering handles - and the box only when there is more than one
 * object, because around a single object the outline and the box would be the same line drawn
 * twice.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) {
    return null;
  }
  const box = selectionBounds(snapshot, ids);
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const line = 1 / zoom;
  const size = HANDLE_SIZE_PX / zoom;
  const resizable = selected.some((object) => getObjectType(object.type)?.resizable === true);

  return (
    <div className="selection-overlay" data-testid="selection-overlay" data-resizable={resizable ? 'true' : 'false'}>
      {selected.map((object) => (
        <div
          key={object.id}
          className="selection-outline"
          data-testid="selection-outline"
          data-object-id={object.id}
          data-object-type={object.type}
          aria-hidden="true"
          style={{
            left: `${objectBounds(object).x}px`,
            top: `${objectBounds(object).y}px`,
            width: `${object.width}px`,
            height: `${object.height}px`,
            borderWidth: `${line}px`,
          }}
        />
      ))}
      {box !== null && selected.length > 1 ? (
        <div
          className="selection-bounds"
          data-testid="selection-bounds"
          data-width={Math.round(box.width)}
          data-height={Math.round(box.height)}
          aria-hidden="true"
          style={{
            left: `${box.x}px`,
            top: `${box.y}px`,
            width: `${box.width}px`,
            height: `${box.height}px`,
            borderWidth: `${line}px`,
          }}
        />
      ) : null}
      {box !== null && resizable
        ? HANDLES.map((handle) => {
            const point = handlePoint(box, handle);
            return (
              <button
                key={handle}
                type="button"
                className="selection-handle"
                data-testid="resize-handle"
                data-handle={handle}
                aria-label={`Resize ${HANDLE_POSITION[handle]}`}
                title={`Resize ${HANDLE_POSITION[handle]}`}
                style={{
                  left: `${point.x - size / 2}px`,
                  top: `${point.y - size / 2}px`,
                  width: `${size}px`,
                  height: `${size}px`,
                  borderWidth: `${line}px`,
                  cursor: HANDLE_CURSOR[handle],
                }}
                onPointerDown={(event) => {
                  // A handle is neither the board nor an object: it starts a resize, and neither
                  // a pan nor a marquee nor a move of the selection itself.
                  event.stopPropagation();
                  onHandlePointerDown(event, handle);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
              />
            );
          })
        : null}
    </div>
  );
}
