/**
 * SelectionOverlay: per-object outlines and bounding box with 8 resize handles
 * rendered in screen space (handles are constant size regardless of zoom).
 */

import type React from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

const HANDLE_POSITIONS: { handle: Handle; label: string; dx: number; dy: number }[] = [
  { handle: 'nw', label: 'Resize top-left', dx: 0, dy: 0 },
  { handle: 'n', label: 'Resize top', dx: 0.5, dy: 0 },
  { handle: 'ne', label: 'Resize top-right', dx: 1, dy: 0 },
  { handle: 'e', label: 'Resize right', dx: 1, dy: 0.5 },
  { handle: 'se', label: 'Resize bottom-right', dx: 1, dy: 1 },
  { handle: 's', label: 'Resize bottom', dx: 0.5, dy: 1 },
  { handle: 'sw', label: 'Resize bottom-left', dx: 0, dy: 1 },
  { handle: 'w', label: 'Resize left', dx: 0, dy: 0.5 },
];

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/**
 * Renders:
 * 1. A thin outline around each selected object (rendered via data-selected on the object).
 * 2. A bounding box around the whole selection with 8 resize handles.
 *
 * The bounding box and handles are rendered in screen space (positioned absolutely
 * relative to the viewport).
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  // Collect bounds of selected objects that exist in the snapshot
  const selectedRects: Rect[] = [];
  for (const obj of snapshot) {
    if (ids.has(obj.id)) {
      selectedRects.push(objectBounds(obj));
    }
  }
  if (selectedRects.length === 0) return null;

  const bbox = unionRects(selectedRects);
  if (!bbox) return null;

  // Check if any selected type is resizable and determine handle mode
  let anyResizable = false;
  let horizontalOnly = true;
  for (const obj of snapshot) {
    if (!ids.has(obj.id)) continue;
    const spec = getObjectType(obj.type);
    if (spec?.resizable) {
      anyResizable = true;
      if (spec.handles !== 'horizontal') {
        horizontalOnly = false;
      }
    } else {
      horizontalOnly = false;
    }
  }

  // Only show horizontal handles when ALL selected resizable types are horizontal-only
  const showHandles = anyResizable ? (horizontalOnly ? HANDLE_POSITIONS.filter(h => h.handle === 'e' || h.handle === 'w') : HANDLE_POSITIONS) : [];

  // Convert bounding box to screen coords
  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const bottomRight = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });
  const screenLeft = topLeft.x;
  const screenTop = topLeft.y;
  const screenWidth = bottomRight.x - topLeft.x;
  const screenHeight = bottomRight.y - topLeft.y;

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10000,
      }}
    >
      {/* Bounding box */}
      <div
        data-testid="selection-bounding-box"
        style={{
          position: 'absolute',
          left: screenLeft,
          top: screenTop,
          width: screenWidth,
          height: screenHeight,
          border: '1px solid #1976D2',
          boxSizing: 'border-box',
          pointerEvents: 'none',
        }}
      />
      {/* Handles (only when resizable) */}
      {showHandles.length > 0 &&
        showHandles.map(({ handle, label, dx, dy }) => {
          const hx = screenLeft + screenWidth * dx - HANDLE_SIZE_PX / 2;
          const hy = screenTop + screenHeight * dy - HANDLE_SIZE_PX / 2;
          return (
            <div
              key={handle}
              data-testid={`handle-${handle}`}
              role="button"
              aria-label={label}
              style={{
                position: 'absolute',
                left: hx,
                top: hy,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                background: '#fff',
                border: '1px solid #1976D2',
                borderRadius: 1,
                cursor: CURSORS[handle],
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
            />
          );
        })}
    </div>
  );
}
