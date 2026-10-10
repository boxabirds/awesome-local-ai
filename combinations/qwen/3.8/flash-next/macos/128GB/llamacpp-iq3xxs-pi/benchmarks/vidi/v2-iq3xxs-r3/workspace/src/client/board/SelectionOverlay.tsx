import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, HANDLE_LABELS, unionRects } from '../../shared/geometry';
import {
  handleMovesBottom,
  handleMovesLeft,
  handleMovesRight,
  handleMovesTop,
} from '../../shared/geometry';
import type { Handle, Rect } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';

/**
 * The bounding box of a selection, or `null` when nothing is selected that the
 * board can draw. Objects are looked up by id rather than trusted from the
 * selection, because another person may have deleted one since it was selected.
 */
export function boundingBox(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): Rect | null {
  return unionRects(
    snapshot.filter((object) => ids.has(object.id)).map((object) => objectBounds(object)),
  );
}

/** Would any of these objects accept a resize handle? */
function anyResizable(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): boolean {
  return snapshot.some((object) => ids.has(object.id) && (getObjectType(object.type)?.resizable ?? false));
}

export interface SelectionOverlayProps {
  /** The selected ids; nothing is drawn for an empty selection. */
  readonly ids: ReadonlySet<string>;
  /** What the board can currently draw. */
  readonly snapshot: readonly ObjectSnapshot[];
  readonly camera: Camera;
  /**
   * False while this client may not write to the board: outlines stay (reading
   * is not writing) but handles go, because a handle that cannot resize would be
   * a lie (`persist.client_status`).
   */
  readonly editable?: boolean;
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

/**
 * The screen-space chrome of a selection: its bounding box and the eight handles
 * that resize it (`sel.bounding_box`, `sel.resize`).
 *
 * Per-object outlines are not drawn here — each object draws its own from its
 * `data-selected` attribute, in its own shape — because an outline that followed
 * the box instead would suggest a rectangle that is not the object. Only the box
 * and the handles are ours, and both are placed in screen pixels: the handles
 * stay `HANDLE_SIZE_PX` big whatever the zoom, so a note at 10% is still
 * grabbable, and a box that covered the whole board is still one line wide.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  editable = true,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  const box = boundingBox(ids, snapshot);
  if (!box) return null;
  const origin = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;
  const half = HANDLE_SIZE_PX / 2;
  const place = (handle: Handle): CSSProperties => {
    const left = handleMovesLeft(handle) ? 0 : handleMovesRight(handle) ? width : width / 2;
    const top = handleMovesTop(handle) ? 0 : handleMovesBottom(handle) ? height : height / 2;
    return {
      left: `${left - half}px`,
      top: `${top - half}px`,
      width: `${HANDLE_SIZE_PX}px`,
      height: `${HANDLE_SIZE_PX}px`,
      cursor: CURSORS[handle],
    };
  };
  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      data-box-x={box.x}
      data-box-y={box.y}
      data-box-width={box.width}
      data-box-height={box.height}
      style={{ left: `${origin.x}px`, top: `${origin.y}px`, width: `${width}px`, height: `${height}px` }}
    >
      {editable && anyResizable(ids, snapshot)
        ? HANDLES.map((handle) => (
            <button
              key={handle}
              type="button"
              className={`selection-handle selection-handle-${handle}`}
              data-testid={`handle-${handle}`}
              data-handle={handle}
              // The visible box is decoration; the handle is a control, and it
              // says which of the eight it is ("Resize top-left").
              aria-label={`Resize ${HANDLE_LABELS[handle]}`}
              style={place(handle)}
              onPointerDown={(event) => onHandlePointerDown(event, handle)}
            />
          ))
        : null}
    </div>
  );
}

/** Which way each handle pulls, so the pointer says what the drag does. */
const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};
