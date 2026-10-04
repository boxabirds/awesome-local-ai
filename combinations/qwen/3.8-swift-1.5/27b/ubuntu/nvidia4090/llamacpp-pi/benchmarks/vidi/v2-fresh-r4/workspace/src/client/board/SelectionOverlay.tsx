import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';
import type { Camera, Point } from '../canvas/camera';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

const HANDLES: { handle: Handle; label: string; pos: (rect: Rect) => Point }[] = [
  { handle: 'nw', label: 'top-left', pos: (r) => ({ x: r.x, y: r.y }) },
  { handle: 'n', label: 'top', pos: (r) => ({ x: r.x + r.width / 2, y: r.y }) },
  { handle: 'ne', label: 'top-right', pos: (r) => ({ x: r.x + r.width, y: r.y }) },
  { handle: 'e', label: 'right', pos: (r) => ({ x: r.x + r.width, y: r.y + r.height / 2 }) },
  { handle: 'se', label: 'bottom-right', pos: (r) => ({ x: r.x + r.width, y: r.y + r.height }) },
  { handle: 's', label: 'bottom', pos: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height }) },
  { handle: 'sw', label: 'bottom-left', pos: (r) => ({ x: r.x, y: r.y + r.height }) },
  { handle: 'w', label: 'left', pos: (r) => ({ x: r.x, y: r.y + r.height / 2 }) },
];

/**
 * Renders the selection bounding box and 8 resize handles in screen space.
 * Handles are hidden when no selected type is resizable.
 */
export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  if (ids.size === 0) return null;

  // Get bounds of all selected objects
  const selectedObjs = snapshot.filter((s) => ids.has(s.id));
  if (selectedObjs.length === 0) return null;

  const rects = selectedObjs.map(objectBounds);
  const boundingBox = unionRects(rects);
  if (!boundingBox) return null;

  // Decide which handles to show (story 9):
  // - all selected types resizable + horizontal-only (text) → e/w only
  // - all selected types resizable (sticky) → all 8
  // - mixed resizable semantics (sticky + text) → no handles
  const specs = selectedObjs.map((obj) => getObjectType(obj.type));
  const resizableObjs = selectedObjs.filter((_, i) => specs[i]?.resizable);
  const horizontalObjs = selectedObjs.filter((_, i) => specs[i]?.resizable && specs[i]?.horizontalOnly);
  const fullObjs = selectedObjs.filter((_, i) => specs[i]?.resizable && !specs[i]?.horizontalOnly);
  let handles: typeof HANDLES;
  if (resizableObjs.length === selectedObjs.length && horizontalObjs.length === selectedObjs.length) {
    handles = HANDLES.filter((h) => h.handle === 'e' || h.handle === 'w');
  } else if (fullObjs.length > 0 && horizontalObjs.length === 0) {
    handles = HANDLES;
  } else {
    handles = [];
  }

  // Convert bounding box to screen space
  const screenX = (boundingBox.x - camera.x) * camera.zoom;
  const screenY = (boundingBox.y - camera.y) * camera.zoom;
  const screenW = boundingBox.width * camera.zoom;
  const screenH = boundingBox.height * camera.zoom;

  return (
    <div className="selection-overlay" data-vidi6="selection-overlay">
      {/* Bounding box outline */}
      <div
        className="selection-bbox"
        data-vidi6="selection-bbox"
        style={{
          position: 'absolute',
          left: `${screenX}px`,
          top: `${screenY}px`,
          width: `${screenW}px`,
          height: `${screenH}px`,
          border: '1.5px solid #4285F4',
          pointerEvents: 'none',
        }}
      />
      {/* Resize handles */}
      {handles.map(({ handle, label, pos }) => {
          const worldPos = pos(boundingBox);
          const sx = (worldPos.x - camera.x) * camera.zoom;
          const sy = (worldPos.y - camera.y) * camera.zoom;
          return (
            <div
              key={handle}
              className="selection-handle"
              data-vidi6="selection-handle"
              data-handle={handle}
              role="button"
              aria-label={`Resize ${label}`}
              tabIndex={-1}
              style={{
                position: 'absolute',
                left: `${sx - HANDLE_SIZE_PX / 2}px`,
                top: `${sy - HANDLE_SIZE_PX / 2}px`,
                width: `${HANDLE_SIZE_PX}px`,
                height: `${HANDLE_SIZE_PX}px`,
                backgroundColor: '#fff',
                border: '1.5px solid #4285F4',
                cursor: handleCursor(handle),
                zIndex: 10000,
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

function handleCursor(handle: Handle): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
  }
}
