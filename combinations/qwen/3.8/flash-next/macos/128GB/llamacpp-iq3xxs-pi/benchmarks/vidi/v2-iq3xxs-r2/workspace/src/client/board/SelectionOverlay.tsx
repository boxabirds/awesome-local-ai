import { type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLES, handleLabel, unionRects, type Handle, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  /** The selected ids; the box is drawn around all of them together. */
  readonly ids: ReadonlySet<string>;
  readonly snapshot: readonly ObjectSnapshot[];
  readonly camera: Camera;
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

/** Where a handle sits, as a fraction of the box: `nw` is its top-left corner. */
const HANDLE_ANCHORS: Record<Handle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

/** The mouse pointer that suggests what a handle will do. */
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

/**
 * The box around what is selected, and the 8 handles that resize it.
 *
 * It draws in *screen* space, on top of the world layer: the box follows the camera, but a
 * handle is always `HANDLE_SIZE_PX` wide however far away the board is zoomed, so a
 * selection of two notes at 20% is as grabbable as one at 200%.
 *
 * One box rather than one per object, because a group resize scales the box and everything
 * inside it together (sel.resize) — eight handles around each of nine notes could only
 * mean nine separate resizes, which is not what a group is.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;
  const box: Rect | null = unionRects(selected.map(objectBounds));
  if (box === null) return null;
  // A selection of a type that cannot be resized (an object type from stories 9–12 that
  // declares `resizable: false`) gets the box but no handles, and the gesture ignores a
  // press on a handle that should not have been there.
  const resizable = selected.some((object) => getObjectType(object.type)?.resizable === true);

  const from = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return (
    <div className="vidi6-selection-layer" data-testid="selection-layer">
      <div
        className="vidi6-selection-box"
        data-testid="selection-box"
        aria-hidden="true"
        data-box-x={box.x}
        data-box-y={box.y}
        data-box-width={box.width}
        data-box-height={box.height}
        style={{ left: `${from.x}px`, top: `${from.y}px`, width: `${width}px`, height: `${height}px` }}
      />
      {resizable
        ? HANDLES.map((handle) => {
            const anchor = HANDLE_ANCHORS[handle];
            return (
              <button
                key={handle}
                type="button"
                className="vidi6-selection-handle"
                data-handle={handle}
                aria-label={handleLabel(handle)}
                tabIndex={-1}
                style={{
                  left: `${from.x + anchor.x * width - HANDLE_SIZE_PX / 2}px`,
                  top: `${from.y + anchor.y * height - HANDLE_SIZE_PX / 2}px`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                  cursor: HANDLE_CURSORS[handle],
                }}
                onPointerDown={(event) => {
                  // The handle belongs to the selection, not to the board behind it: no
                  // pan, and no other object under the handle is pressed.
                  event.stopPropagation();
                  onHandlePointerDown(event, handle);
                }}
              />
            );
          })
        : null}
    </div>
  );
}
