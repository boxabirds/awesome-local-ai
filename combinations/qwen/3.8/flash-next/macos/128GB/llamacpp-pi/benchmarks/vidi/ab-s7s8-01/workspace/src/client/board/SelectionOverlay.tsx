// The selection affordances (sel.visuals): a 2 px-blue-equivalent outline per
// selected object, a bounding box around the group, and eight resize handles.
//
// It renders INSIDE the zoomed world layer, so the affordances sit exactly over
// the objects they describe at any zoom. Sizes that the PRD states in SCREEN
// pixels (8 px handles / border) are divided by the zoom to get their world size.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLES, HANDLE_LABELS, unionRects, type Handle, type Rect } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const OUTLINE_COLOR = '#2563eb';
/** The per-object selection outline, in SCREEN pixels (divided by the zoom below). */
const OUTLINE_PX = 2;

/** A handle's point on the bounding box, in world units. */
function handlePoint(bbox: Rect, handle: Handle): { x: number; y: number } {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const right = bbox.x + bbox.width;
  const bottom = bbox.y + bbox.height;
  switch (handle) {
    case 'n':
      return { x: cx, y: bbox.y };
    case 's':
      return { x: cx, y: bottom };
    case 'w':
      return { x: bbox.x, y: cy };
    case 'e':
      return { x: right, y: cy };
    case 'nw':
      return { x: bbox.x, y: bbox.y };
    case 'ne':
      return { x: right, y: bbox.y };
    case 'sw':
      return { x: bbox.x, y: bottom };
    case 'se':
      return { x: right, y: bottom };
  }
}

/** The CSS cursor for a handle (the design's nwse / nesw / ns / ew mapping). */
export function handleCursor(handle: Handle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
  }
}

export interface SelectionOverlayProps {
  /** Only the selected objects. */
  objects: readonly ObjectSnapshot[];
  /** Only `zoom` is used: to keep the border and handles a constant screen size. */
  camera: Camera;
  /** False while the board is read-only (story 4 load failure): no affordances. */
  editable: boolean;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

export const SelectionOverlay = ({ objects, camera, editable, onHandlePointerDown }: SelectionOverlayProps) => {
  if (!editable || objects.length === 0) return null;

  const z = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
  const handleSize = HANDLE_SIZE_PX / z; // world units for what is 8 px on screen
  const line = OUTLINE_PX / z;
  const bounds = objects.map(objectBounds);
  const bbox = unionRects(bounds);
  // A selection containing a type that cannot be resized shows outlines only.
  const resizable = objects.every((o) => getObjectType(o.type)?.resizable !== false);

  return (
    <>
      {objects.map((o) => {
        const b = objectBounds(o);
        return (
          <div
            key={`outline-${o.id}`}
            data-testid="selection-outline"
            data-obj-id={o.id}
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: b.x,
              top: b.y,
              width: b.width,
              height: b.height,
              outline: `${line}px solid ${OUTLINE_COLOR}`,
              outlineOffset: 0,
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {bbox && (
        <div
          data-testid="selection-bbox"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: bbox.x,
            top: bbox.y,
            width: bbox.width,
            height: bbox.height,
            border: `${line / 2}px dashed rgba(37, 99, 235, 0.55)`,
            boxSizing: 'border-box',
            pointerEvents: 'none',
          }}
        />
      )}

      {resizable &&
        bbox &&
        HANDLES.map((handle) => {
          const p = handlePoint(bbox, handle);
          return (
            <div
              key={`handle-${handle}`}
              data-testid="resize-handle"
              data-handle={handle}
              role="button"
              aria-label={HANDLE_LABELS[handle]}
              tabIndex={-1}
              onPointerDown={(e) => {
                // Never reach the board (that would clear the selection and pan).
                e.stopPropagation();
                e.preventDefault();
                onHandlePointerDown(e, handle);
              }}
              style={{
                position: 'absolute',
                left: p.x - handleSize / 2,
                top: p.y - handleSize / 2,
                width: handleSize,
                height: handleSize,
                background: '#ffffff',
                border: `${line}px solid ${OUTLINE_COLOR}`,
                borderRadius: handleSize * 0.15,
                boxSizing: 'border-box',
                cursor: handleCursor(handle),
                // The world layer ignores pointers; the handles take them back.
                pointerEvents: 'auto',
              }}
            />
          );
        })}
    </>
  );
};
