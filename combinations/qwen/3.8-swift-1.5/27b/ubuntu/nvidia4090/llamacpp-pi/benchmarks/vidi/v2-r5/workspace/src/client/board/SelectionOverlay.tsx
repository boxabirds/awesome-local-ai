// src/client/board/SelectionOverlay.tsx
// Renders per-object outlines, bounding box, and 8 resize handles in screen space.

import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { unionRects, type Rect, type Handle } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: React.PointerEvent, handle: Handle) => void;
}

const HANDLE_POSITIONS: { handle: Handle; label: string; getPos: (r: { x: number; y: number; w: number; h: number }) => { x: number; y: number } }[] = [
  { handle: 'nw', label: 'top-left', getPos: (r) => ({ x: r.x, y: r.y }) },
  { handle: 'n', label: 'top', getPos: (r) => ({ x: r.x + r.w / 2, y: r.y }) },
  { handle: 'ne', label: 'top-right', getPos: (r) => ({ x: r.x + r.w, y: r.y }) },
  { handle: 'e', label: 'right', getPos: (r) => ({ x: r.x + r.w, y: r.y + r.h / 2 }) },
  { handle: 'se', label: 'bottom-right', getPos: (r) => ({ x: r.x + r.w, y: r.y + r.h }) },
  { handle: 's', label: 'bottom', getPos: (r) => ({ x: r.x + r.w / 2, y: r.y + r.h }) },
  { handle: 'sw', label: 'bottom-left', getPos: (r) => ({ x: r.x, y: r.y + r.h }) },
  { handle: 'w', label: 'left', getPos: (r) => ({ x: r.x, y: r.y + r.h / 2 }) },
];

export function SelectionOverlay(props: SelectionOverlayProps): ReactElement | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  if (ids.size === 0) return null;

  // Compute bounding box in world space
  const selectedRects: Rect[] = [];
  let anyResizable = false;
  for (const id of ids) {
    const obj = snapshot.find(o => o.id === id);
    if (!obj) continue;
    selectedRects.push(objectBounds(obj));
    const spec = getObjectType(obj.type);
    if (spec?.resizable) anyResizable = true;
  }

  const bbox = unionRects(selectedRects);
  if (!bbox) return null;

  // Convert to screen space
  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const w = bbox.width * camera.zoom;
  const h = bbox.height * camera.zoom;

  const screenRect = { x: topLeft.x, y: topLeft.y, w, h };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Bounding box */}
      <div
        data-testid="selection-bounding-box"
        style={{
          position: 'absolute',
          left: screenRect.x,
          top: screenRect.y,
          width: w,
          height: h,
          border: '1.5px solid #2196F3',
          borderRadius: 1,
          pointerEvents: 'none',
        }}
      />

      {/* Resize handles (only if any selected type is resizable) */}
      {anyResizable && HANDLE_POSITIONS.map(({ handle, label, getPos }) => {
        const pos = getPos(screenRect);
        return (
          <div
            key={handle}
            data-testid={`resize-handle-${handle}`}
            data-handle={handle}
            role="button"
            aria-label={`Resize ${label}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
            style={{
              position: 'absolute',
              left: pos.x - HANDLE_SIZE_PX / 2,
              top: pos.y - HANDLE_SIZE_PX / 2,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              background: 'white',
              border: '1.5px solid #2196F3',
              borderRadius: 2,
              pointerEvents: 'auto',
              cursor: getCursor(handle),
              zIndex: 10,
            }}
          />
        );
      })}
    </div>
  );
}

function getCursor(handle: Handle): string {
  switch (handle) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
    default: return 'default';
  }
}
