import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects } from '../../shared/geometry';
import type { Handle } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

const HANDLES: Array<{ handle: Handle; label: string; cx: 'left' | 'center' | 'right'; cy: 'top' | 'center' | 'bottom' }> = [
  { handle: 'nw', label: 'Resize top-left', cx: 'left', cy: 'top' },
  { handle: 'n', label: 'Resize top', cx: 'center', cy: 'top' },
  { handle: 'ne', label: 'Resize top-right', cx: 'right', cy: 'top' },
  { handle: 'e', label: 'Resize right', cx: 'right', cy: 'center' },
  { handle: 'se', label: 'Resize bottom-right', cx: 'right', cy: 'bottom' },
  { handle: 's', label: 'Resize bottom', cx: 'center', cy: 'bottom' },
  { handle: 'sw', label: 'Resize bottom-left', cx: 'left', cy: 'bottom' },
  { handle: 'w', label: 'Resize left', cx: 'left', cy: 'center' },
];

function anyResizable(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): boolean {
  for (const obj of snapshot) {
    if (ids.has(obj.id)) {
      const spec = getObjectType(obj.type);
      if (spec?.resizable) return true;
    }
  }
  return false;
}

function getCursor(handle: Handle): string {
  switch (handle) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
  }
}

/**
 * Draws the bounding box and 8 resize handles in screen space.
 * Returns null when no selected type is resizable or selection is empty.
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  const selectedRects: { x: number; y: number; width: number; height: number }[] = [];
  for (const obj of snapshot) {
    if (ids.has(obj.id)) {
      selectedRects.push(objectBounds(obj));
    }
  }
  if (selectedRects.length === 0) return null;

  const bbox = unionRects(selectedRects);
  if (!bbox) return null;

  const showHandles = anyResizable(ids, snapshot);

  // Convert bounding box to screen space
  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const bottomRight = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });
  const screenLeft = topLeft.x;
  const screenTop = topLeft.y;
  const screenWidth = bottomRight.x - topLeft.x;
  const screenHeight = bottomRight.y - topLeft.y;

  const half = HANDLE_SIZE_PX / 2;

  function handlePos(cx: 'left' | 'center' | 'right', cy: 'top' | 'center' | 'bottom') {
    let x: number;
    let y: number;
    if (cx === 'left') x = screenLeft;
    else if (cx === 'right') x = screenLeft + screenWidth;
    else x = screenLeft + screenWidth / 2;
    if (cy === 'top') y = screenTop;
    else if (cy === 'bottom') y = screenTop + screenHeight;
    else y = screenTop + screenHeight / 2;
    return { x, y };
  }

  return (
    <div
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 999,
      }}
    >
      {/* Bounding box outline */}
      <div
        data-testid="selection-bbox"
        style={{
          position: 'absolute',
          left: screenLeft,
          top: screenTop,
          width: screenWidth,
          height: screenHeight,
          border: '1px solid #1976D2',
          pointerEvents: 'none',
        }}
      />
      {/* Handles */}
      {showHandles &&
        HANDLES.map(({ handle, label, cx, cy }) => {
          const pos = handlePos(cx, cy);
          return (
            <div
              key={handle}
              data-testid={`handle-${handle}`}
              aria-label={label}
              role="button"
              tabIndex={-1}
              style={{
                position: 'absolute',
                left: pos.x - half,
                top: pos.y - half,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                backgroundColor: '#fff',
                border: '1px solid #1976D2',
                cursor: getCursor(handle),
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
