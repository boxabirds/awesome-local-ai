/**
 * The outlines and handles that say what is selected.
 *
 * Two layers of drawing, and the difference between them is the point:
 *
 * - **One outline per selected object**, so a selection of six notes shows six objects, not one shape
 *   whose area happens to cover them. The PRD's "every selected object is highlighted at once" is a
 *   statement about per-object drawing: a bounding box alone would hide which objects are in and which
 *   are only nearby.
 * - **One box around the lot, with handles on it**, which is the thing being resized. The box is the
 *   selection's shape; resizing it scales everything inside it together.
 *
 * Both are drawn in screen units, computed from the board rect of each object and the camera. Handles
 * are HANDLE_SIZE_PX *pixels* rather than board units, so they stay the size of a target worth hitting
 * at 10% zoom, where an 8-unit handle would be a dot too small to find. The price is that this layer is
 * redrawn whenever the camera moves, which is exactly when it would have to be corrected anyway.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Handle, Point, Rect } from '../../shared/geometry';
import { HANDLES, HANDLE_LABELS, unionRects } from '../../shared/geometry';
import { worldToScreen, screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { describeSelection, hitTestObject } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(event: PointerEvent | ReactPointerEvent, handle: Handle): void;
}

/** Which corner or edge a handle sits on, in board units. */
function handlePoint(box: Rect, handle: Handle): Point {
  return {
    x: handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : box.x + box.width / 2,
    y: handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : box.y + box.height / 2,
  };
}

/** The cursor that says what this handle will do before it is pressed. */
const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** An object's rect, in the same units the board is drawn in. */
function boundsOf(object: ObjectSnapshot): Rect {
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/** Screen-space box for a rect in board units: position and size, in pixels, from the camera. */
function screenBox(rect: Rect, camera: Camera): { left: number; top: number; width: number; height: number } {
  const origin = worldToScreen(camera, { x: rect.x, y: rect.y });
  return { left: origin.x, top: origin.y, width: rect.width * camera.zoom, height: rect.height * camera.zoom };
}

function styleOf(box: { left: number; top: number; width: number; height: number }): React.CSSProperties {
  return { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` };
}

/**
 * Whether an object that is not part of this selection is drawn under this point of the board.
 *
 * This is asked of the document rather than of the page, so that the answer is the same in a browser and
 * in a test, and so that it does not depend on what happens to be painted on top at the moment somebody
 * asks. The hit test is the one the board already uses for drawing a rectangle round things, so a handle
 * and a rectangle cannot disagree about what is where.
 */
function coveredBySomethingElse(
  snapshot: readonly ObjectSnapshot[],
  ids: ReadonlySet<string>,
  point: Point,
): boolean {
  return snapshot.some((object) => !ids.has(object.id) && hitTestObject(object, point));
}

/**
 * The outlines and the handles.
 *
 * Renders nothing when nothing is selected — which includes the case of a selection whose objects have
 * all been deleted, because by then the board has been pruned and there is nothing left to outline.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  if (ids.size === 0) return null;
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  const bounds = unionRects(selected.map(boundsOf));
  if (bounds === null) return null;

  // A selection that includes one object of a type that cannot be resized shows no handles at all:
  // half a resize control, which is what hiding them on one object of a group would amount to, offers
  // an action that cannot be carried out.
  const { resizable } = describeSelection(selected);

  return (
    <div className="selection-overlay" data-testid="selection-overlay" aria-hidden="false">
      {selected.map((object) => {
        const box = screenBox(boundsOf(object), camera);
        return (
          <div
            key={object.id}
            className="selection-outline"
            data-testid="selection-outline"
            data-object-id={object.id}
            style={styleOf(box)}
          />
        );
      })}
      <div className="selection-bounds" data-testid="selection-bounds" style={styleOf(screenBox(bounds, camera))} />
      {resizable
        ? HANDLES.map((handle) => {
            const point = worldToScreen(camera, handlePoint(bounds, handle));
            const half = HANDLE_SIZE_PX / 2;
            // A handle is 8 pixels of the board, and whatever is drawn under it is a thing a person can
            // see and mean to press. Where an object outside this selection is drawn there, the handle
            // stands down: an 8-pixel control that eats the click aimed at somebody else's note is worse
            // than no control, because the note is the thing the person was looking at, and there are
            // seven other handles to resize with. Note that the *outline* of the box is still drawn — the
            // box is a fact about the selection, while the handle is an offer, and an offer that cannot
            // be taken is not worth making.
            if (coveredBySomethingElse(snapshot, ids, screenToWorld(camera, point))) return null;
            return (
              <div
                key={handle}
                role="button"
                className={`selection-handle selection-handle--${handle}`}
                data-testid={`resize-handle-${handle}`}
                data-handle={handle}
                aria-label={HANDLE_LABELS[handle]}
                style={{
                  left: `${point.x - half}px`,
                  top: `${point.y - half}px`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                  cursor: HANDLE_CURSORS[handle],
                }}
                onPointerDown={(event) => {
                  onHandlePointerDown(event, handle);
                }}
              />
            );
          })
        : null}
    </div>
  );
}
