/**
 * The selection's bounding box and its eight resize handles (`sel.resize`, `sel.all_types`).
 *
 * It is drawn in *screen* space, as a sibling of the viewport rather than inside the world
 * layer, so the handles stay `HANDLE_SIZE_PX` across the screen whatever the zoom is: a
 * handle that scaled with the board would be a two-pixel target when zoomed out and cover
 * the note when zoomed in.
 *
 * Per-object outlines are not drawn here — each object says `data-selected` about itself
 * and the stylesheet draws the outline — because only the object knows its own shape.
 */

import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { selectionIsResizable, type PointerLike } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(event: PointerLike, handle: Handle): void;
}

interface HandlePlacement {
  handle: Handle;
  /** Where the handle's centre sits, as a fraction of the box. */
  fx: number;
  fy: number;
  /** Spoken name: "Resize top-left". */
  label: string;
}

const HANDLES: HandlePlacement[] = [
  { handle: 'nw', fx: 0, fy: 0, label: 'top-left' },
  { handle: 'n', fx: 0.5, fy: 0, label: 'top' },
  { handle: 'ne', fx: 1, fy: 0, label: 'top-right' },
  { handle: 'e', fx: 1, fy: 0.5, label: 'right' },
  { handle: 'se', fx: 1, fy: 1, label: 'bottom-right' },
  { handle: 's', fx: 0.5, fy: 1, label: 'bottom' },
  { handle: 'sw', fx: 0, fy: 1, label: 'bottom-left' },
  { handle: 'w', fx: 0, fy: 0.5, label: 'left' }
];

/** The cursor each handle asks for, so the pointer says what the drag will do. */
const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize'
};

/** Where a board-unit box lands on the screen. */
export function boxToScreen(box: Rect, camera: Camera): { left: number; top: number; width: number; height: number } {
  const corner = worldToScreen(camera, { x: box.x, y: box.y });
  return { left: corner.x, top: corner.y, width: box.width * camera.zoom, height: box.height * camera.zoom };
}

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((object) => ids.has(object.id));
  const box = unionRects(selected.map((object) => objectBounds(object)));
  if (!box) return null;
  const screen = boxToScreen(box, camera);
  // Handles only appear for a type that can be resized; an object that cannot is still
  // outlined and still moves.
  const resizable = selectionIsResizable(selected.map((object) => object.type));
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div
      className="vidi6-selection-overlay"
      data-vidi6="selection-overlay"
      data-testid="selection-overlay"
      style={{ left: screen.left, top: screen.top, width: screen.width, height: screen.height }}
    >
      {resizable
        ? HANDLES.map((placement) => (
            <button
              key={placement.handle}
              type="button"
              className="vidi6-resize-handle"
              data-vidi6="resize-handle"
              data-handle={placement.handle}
              aria-label={`Resize ${placement.label}`}
              title={`Resize ${placement.label}`}
              style={{
                left: screen.width * placement.fx - half,
                top: screen.height * placement.fy - half,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                cursor: CURSORS[placement.handle]
              }}
              onPointerDown={(event) => props.onHandlePointerDown(event, placement.handle)}
            />
          ))
        : null}
    </div>
  );
}
