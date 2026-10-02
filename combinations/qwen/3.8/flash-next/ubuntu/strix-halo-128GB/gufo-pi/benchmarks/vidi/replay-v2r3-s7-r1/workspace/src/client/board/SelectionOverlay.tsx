import React, { useMemo } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Rect, Handle } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
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

const HANDLES: Array<{ handle: Handle; label: string; getPos: (r: Rect) => { x: number; y: number } }> = [
  { handle: 'nw', label: 'Resize top-left', getPos: (r) => ({ x: r.x, y: r.y }) },
  { handle: 'n', label: 'Resize top', getPos: (r) => ({ x: r.x + r.width / 2, y: r.y }) },
  { handle: 'ne', label: 'Resize top-right', getPos: (r) => ({ x: r.x + r.width, y: r.y }) },
  { handle: 'e', label: 'Resize right', getPos: (r) => ({ x: r.x + r.width, y: r.y + r.height / 2 }) },
  { handle: 'se', label: 'Resize bottom-right', getPos: (r) => ({ x: r.x + r.width, y: r.y + r.height }) },
  { handle: 's', label: 'Resize bottom', getPos: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height }) },
  { handle: 'sw', label: 'Resize bottom-left', getPos: (r) => ({ x: r.x, y: r.y + r.height }) },
  { handle: 'w', label: 'Resize left', getPos: (r) => ({ x: r.x, y: r.y + r.height / 2 }) },
];

/**
 * Draws per-object outlines and a bounding box with 8 resize handles in screen space.
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  const selectedObjects = useMemo(
    () => snapshot.filter((o) => ids.has(o.id)),
    [ids, snapshot],
  );

  const bbox = useMemo(() => {
    if (selectedObjects.length === 0) return null;
    return unionRects(selectedObjects.map((o) => objectBounds(o)));
  }, [selectedObjects]);

  // Check if any selected object type is resizable
  const anyResizable = useMemo(() => {
    for (const obj of selectedObjects) {
      const spec = getObjectType(obj.type);
      if (spec?.resizable) return true;
    }
    return false;
  }, [selectedObjects]);

  if (selectedObjects.length === 0) return null;

  const hs = HANDLE_SIZE_PX;

  return (
    <>
      {/* Bounding box and handles in screen space (rendered outside world layer) */}
      {bbox && (
        <>
          <BoundingBoxAndHandles
            bbox={bbox}
            camera={camera}
            anyResizable={anyResizable}
            onHandlePointerDown={onHandlePointerDown}
            hs={hs}
          />
        </>
      )}
    </>
  );
}

interface BBProps {
  bbox: Rect;
  camera: Camera;
  anyResizable: boolean;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
  hs: number;
}

function BoundingBoxAndHandles({ bbox, camera, anyResizable, onHandlePointerDown, hs }: BBProps) {
  const tl = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const br = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });
  const screenW = br.x - tl.x;
  const screenH = br.y - tl.y;

  return (
    <>
      {/* Bounding box outline */}
      <div
        data-testid="selection-bounding-box"
        style={{
          position: 'absolute',
          left: tl.x,
          top: tl.y,
          width: screenW,
          height: screenH,
          border: '1px solid #1976D2',
          pointerEvents: 'none',
          zIndex: 999,
        }}
      />
      {/* Resize handles */}
      {anyResizable &&
        HANDLES.map(({ handle, label, getPos }) => {
          const worldPos = getPos(bbox);
          const screenPos = worldToScreen(camera, worldPos);
          return (
            <div
              key={handle}
              data-testid={`handle-${handle}`}
              aria-label={label}
              role="button"
              style={{
                position: 'absolute',
                left: screenPos.x - hs / 2,
                top: screenPos.y - hs / 2,
                width: hs,
                height: hs,
                backgroundColor: '#fff',
                border: '1.5px solid #1976D2',
                borderRadius: 1,
                cursor: getCursor(handle),
                zIndex: 1001,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
            />
          );
        })}
    </>
  );
}

function getCursor(handle: Handle): string {
  switch (handle) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
  }
}
