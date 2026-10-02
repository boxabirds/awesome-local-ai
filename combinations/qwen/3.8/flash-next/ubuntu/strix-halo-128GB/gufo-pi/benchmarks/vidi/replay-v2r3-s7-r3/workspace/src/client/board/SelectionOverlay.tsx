import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects, type Handle } from '../../shared/geometry';
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

const HANDLES: Array<{ handle: Handle; label: string }> = [
  { handle: 'nw', label: 'Resize top-left' },
  { handle: 'n', label: 'Resize top' },
  { handle: 'ne', label: 'Resize top-right' },
  { handle: 'e', label: 'Resize right' },
  { handle: 'se', label: 'Resize bottom-right' },
  { handle: 's', label: 'Resize bottom' },
  { handle: 'sw', label: 'Resize bottom-left' },
  { handle: 'w', label: 'Resize left' },
];

/**
 * Renders the bounding box and 8 resize handles in screen space.
 * Handles are HANDLE_SIZE_PX regardless of zoom.
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  const selectedObjects = snapshot.filter((o) => ids.has(o.id));
  if (selectedObjects.length === 0) return null;

  const rects = selectedObjects.map(objectBounds);
  const bbox = unionRects(rects);
  if (!bbox) return null;

  // Check if any selected type is resizable
  const anyResizable = selectedObjects.some((o) => {
    const spec = getObjectType(o.type);
    return spec?.resizable;
  });

  const tl = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const br = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });

  const boxW = br.x - tl.x;
  const boxH = br.y - tl.y;

  const half = HANDLE_SIZE_PX / 2;

  function handlePosition(h: Handle): { left: number; top: number } {
    const cx = h.includes('w') ? tl.x : h.includes('e') ? br.x : tl.x + boxW / 2;
    const cy = h.includes('n') ? tl.y : h.includes('s') ? br.y : tl.y + boxH / 2;
    return { left: cx - half, top: cy - half };
  }

  function cursorForHandle(h: Handle): string {
    switch (h) {
      case 'n': case 's': return 'ns-resize';
      case 'e': case 'w': return 'ew-resize';
      case 'ne': case 'sw': return 'nesw-resize';
      case 'nw': case 'se': return 'nwse-resize';
    }
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
          left: tl.x,
          top: tl.y,
          width: boxW,
          height: boxH,
          border: '1px solid #1976D2',
          pointerEvents: 'none',
        }}
      />
      {/* Resize handles */}
      {anyResizable && HANDLES.map(({ handle, label }) => {
        const pos = handlePosition(handle);
        return (
          <button
            key={handle}
            type="button"
            aria-label={label}
            data-testid={`handle-${handle}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
            style={{
              position: 'absolute',
              left: pos.left,
              top: pos.top,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              backgroundColor: '#fff',
              border: '1.5px solid #1976D2',
              borderRadius: 1,
              cursor: cursorForHandle(handle),
              pointerEvents: 'auto',
              padding: 0,
              zIndex: 1001,
            }}
          />
        );
      })}
    </div>
  );
}
