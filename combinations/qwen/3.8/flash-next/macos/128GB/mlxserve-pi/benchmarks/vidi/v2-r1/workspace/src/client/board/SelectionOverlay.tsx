// What a selection looks like (`sel.transform`, `sel.interaction`).
//
// The overlay is drawn in screen space, above the board, and not inside the objects
// themselves. That is what makes it able to describe a selection of any size, of
// mixed object types, at any zoom: one outline per selected object, one box around
// the whole selection, and eight handles on that box — of a constant screen size,
// because a handle you have to zoom in to hit is not a handle.
//
// The handles only appear when something in the selection can be resized at all
// (sel.resize): a selection of objects that cannot be made bigger or smaller gets
// outlines, not handles.
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { BoardObject } from '../../shared/board-model';
import { objectBounds, selectionBounds } from '../../shared/board-model';
import type { Handle } from '../../shared/geometry';
import { HANDLES, HANDLE_LABELS, handlePosition } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { screenOf } from './Marquee';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  /** Every object in the document, so a selected id can be found by rectangle. */
  snapshot: readonly BoardObject[];
  camera: Camera;
  onHandlePointerDown(event: PointerEvent, handle: Handle): void;
}

/** Can anything in this selection be resized? One yes is enough. */
export function selectionIsResizable(
  ids: ReadonlySet<string>,
  snapshot: readonly BoardObject[],
): boolean {
  for (const object of snapshot) {
    if (!ids.has(object.id)) continue;
    if (getObjectType(object.type)?.resizable ?? false) return true;
  }
  return false;
}

const OUTLINE: CSSProperties = {
  position: 'fixed',
  boxSizing: 'border-box',
  border: '1px solid #2f6feb',
  pointerEvents: 'none',
};

export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): ReactNode {
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  const box = selectionBounds(snapshot, [...ids]);
  const where = box ? screenOf(box, camera) : null;
  const resizable = selectionIsResizable(ids, snapshot);

  return (
    <>
      {selected.map((object) => {
        const where = screenOf(objectBounds(object), camera);
        return (
          <div
            key={`outline-${object.id}`}
            data-testid="selection-outline"
            data-id={object.id}
            aria-hidden="true"
            style={{ ...OUTLINE, left: where.x, top: where.y, width: where.width, height: where.height }}
          />
        );
      })}

      {where ? (
        <div
          data-testid="selection-box"
          aria-hidden="true"
          style={{
            ...OUTLINE,
            left: where.x,
            top: where.y,
            width: where.width,
            height: where.height,
            borderStyle: 'dashed',
            borderColor: 'rgba(47, 111, 235, 0.7)',
          }}
        />
      ) : null}

      {box && resizable
        ? HANDLES.map((handle) => {
            const point = worldToScreen(camera, handlePosition(box, handle));
            return (
              <div
                key={handle}
                role="button"
                tabIndex={-1}
                data-testid="resize-handle"
                data-handle={handle}
                aria-label={`Resize ${HANDLE_LABELS[handle]}`}
                style={{
                  position: 'fixed',
                  left: point.x - HANDLE_SIZE_PX / 2,
                  top: point.y - HANDLE_SIZE_PX / 2,
                  width: HANDLE_SIZE_PX,
                  height: HANDLE_SIZE_PX,
                  boxSizing: 'border-box',
                  backgroundColor: '#ffffff',
                  border: '1px solid #2f6feb',
                  borderRadius: 1,
                  // The only part of the overlay that takes pointer input.
                  pointerEvents: 'auto',
                  cursor: handleCursor(handle),
                }}
                onPointerDown={(event: ReactPointerEvent<HTMLDivElement>): void => {
                  event.stopPropagation();
                  onHandlePointerDown(event.nativeEvent, handle);
                }}
              />
            );
          })
        : null}
    </>
  );
}

/** Which way dragging this handle pulls. */
function handleCursor(handle: Handle): string {
  if (handle === 'n' || handle === 's') return 'ns-resize';
  if (handle === 'e' || handle === 'w') return 'ew-resize';
  if (handle === 'ne' || handle === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}
