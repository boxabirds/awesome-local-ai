/**
 * Selection overlay (story 7).
 *
 * Screen-space layer that draws what is selected: a thin outline per object and,
 * around the whole selection, the bounding box with its eight resize handles.
 * Because it is drawn outside the world layer, the outlines and handles keep the
 * same thickness and size at every zoom level.
 */
import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { HANDLES, HANDLE_CURSORS, HANDLE_NAMES, unionRects } from '../../shared/geometry';
import type { Handle, Rect } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX, SELECTION_COLOR } from '../../shared/config';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  editable: boolean;
  /** Drawn in place of the live geometry while a transform gesture runs, so the
   * overlay is not recomputed on every frame of the drag. */
  frozen?: readonly Rect[] | null;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  /** A double-click that lands on the overlay belongs to the board underneath. */
  onEmptyDblClick?(p: { x: number; y: number }): void;
}

/** Screen-space rect of a world rect. */
function toScreen(rect: Rect, camera: Camera) {
  const p = worldToScreen(camera, { x: rect.x, y: rect.y });
  return { left: p.x, top: p.y, width: rect.width * camera.zoom, height: rect.height * camera.zoom };
}

function handlePoint(box: Rect, handle: Handle): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  switch (handle) {
    case 'nw': return { x: box.x, y: box.y };
    case 'n': return { x: cx, y: box.y };
    case 'ne': return { x: right, y: box.y };
    case 'e': return { x: right, y: cy };
    case 'se': return { x: right, y: bottom };
    case 's': return { x: cx, y: bottom };
    case 'sw': return { x: box.x, y: bottom };
    case 'w': return { x: box.x, y: cy };
    default: return { x: cx, y: cy };
  }
}

export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  editable,
  frozen,
  onHandlePointerDown,
  onEmptyDblClick,
}: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  const selected = snapshot.filter((obj) => ids.has(obj.id));
  if (selected.length === 0) return null;

  // While a gesture runs the overlay keeps drawing the rectangles the group started
  // with: only the objects move, the overlay is not updated per frame.
  const rects = frozen
    ? frozen.map((rect, i) => ({ id: `frozen-${i}`, rect }))
    : selected.map((obj) => ({ id: obj.id, rect: objectBounds(obj) }));
  const box = unionRects(rects.map((r) => r.rect));
  if (!box) return null;

  // Resize handles appear when the selection can be resized at all.
  const resizable = frozen
    ? true
    : selected.some((obj) => getObjectType(obj.type)?.resizable === true);
  const screenBox = toScreen(box, camera);
  const showHandles = resizable && editable;

  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      onDoubleClick={(e) => {
        // A handle only reacts to a drag. A double-click that happens to land on
        // one therefore belongs to the empty board space underneath it, and story
        // 2's "double-click creates a note" keeps working under the overlay.
        if (!onEmptyDblClick) return;
        const rect = e.currentTarget.getBoundingClientRect();
        e.stopPropagation();
        onEmptyDblClick({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
    >
      {rects.map(({ id, rect }) => {
        const s = toScreen(rect, camera);
        return (
          <div
            key={id}
            data-testid="selection-outline"
            data-object-id={id}
            style={{
              position: 'absolute',
              left: s.left - 1,
              top: s.top - 1,
              width: s.width + 2,
              height: s.height + 2,
              border: `1px solid ${SELECTION_COLOR}`,
              boxSizing: 'border-box',
            }}
          />
        );
      })}

      {ids.size > 1 && (
        <div
          data-testid="selection-box"
          style={{
            position: 'absolute',
            left: screenBox.left - 4,
            top: screenBox.top - 4,
            width: screenBox.width + 8,
            height: screenBox.height + 8,
            border: `1px solid ${SELECTION_COLOR}`,
            boxSizing: 'border-box',
          }}
        />
      )}

      {showHandles &&
        HANDLES.map((handle) => {
          const p = handlePoint(box, handle);
          const screen = worldToScreen(camera, p);
          return (
            <button
              key={handle}
              type="button"
              data-testid={`resize-handle-${handle}`}
              data-handle={handle}
              aria-label={`Resize ${HANDLE_NAMES[handle]}`}
              onPointerDown={(e) => onHandlePointerDown(e, handle)}
              style={{
                position: 'absolute',
                left: screen.x,
                top: screen.y,
                transform: 'translate(-50%, -50%)',
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                padding: 0,
                margin: 0,
                backgroundColor: '#ffffff',
                border: `1.5px solid ${SELECTION_COLOR}`,
                borderRadius: 2,
                boxSizing: 'border-box',
                cursor: HANDLE_CURSORS[handle],
                pointerEvents: 'auto',
              }}
            />
          );
        })}
    </div>
  );
}
