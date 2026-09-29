import React from 'react';
import { ObjectSnapshot, objectBounds } from '@shared/board-model';
import { Camera } from '@client/canvas/camera';
import { Rect, Handle, unionRects } from '@shared/geometry';
import { HANDLE_SIZE_PX } from '@shared/config';
import { getObjectType } from '@client/objects/registry';

const HANDLE_POSITIONS: Record<Handle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  showHandles: boolean;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

export function SelectionOverlay({ ids, snapshot, camera, showHandles, onHandlePointerDown }: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  // Determine if all selected objects have horizontal-only handles
  let allHorizontal = selected.length > 0;
  for (const obj of selected) {
    const spec = getObjectType(obj.type);
    if (!spec || spec.handles !== 'horizontal') {
      allHorizontal = false;
      break;
    }
  }

  // Draw per-object outlines
  const outlines = selected.map((obj) => {
    const b = objectBounds(obj);
    return (
      <div
        key={`outline-${obj.id}`}
        data-testid="selection-outline"
        data-note-id={obj.id}
        style={{
          position: 'absolute',
          left: b.x,
          top: b.y,
          width: b.width,
          height: b.height,
          border: '2px solid #1976D2',
          pointerEvents: 'none',
          zIndex: 999,
        }}
      />
    );
  });

  // Compute bounding box
  const rects = selected.map(objectBounds);
  const bbox = unionRects(rects);
  if (!bbox) return null;

  return (
    <>
      {outlines}
      <SelectionBoundingBox
        bbox={bbox}
        camera={camera}
        showHandles={showHandles}
        horizontalOnly={allHorizontal}
        onHandlePointerDown={onHandlePointerDown}
      />
    </>
  );
}

interface BoundingBoxProps {
  bbox: Rect;
  camera: Camera;
  showHandles: boolean;
  horizontalOnly?: boolean;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

function SelectionBoundingBox({ bbox, camera, showHandles, horizontalOnly, onHandlePointerDown }: BoundingBoxProps) {
  // Convert world bbox to screen coordinates
  const sx = (bbox.x - camera.x) * camera.zoom;
  const sy = (bbox.y - camera.y) * camera.zoom;
  const sw = bbox.width * camera.zoom;
  const sh = bbox.height * camera.zoom;

  const handles: Handle[] = horizontalOnly
    ? ['e', 'w']
    : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  return (
    <div
      data-testid="bounding-box"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1001,
      }}
    >
      {/* Bounding box border */}
      <div
        style={{
          position: 'absolute',
          left: sx,
          top: sy,
          width: sw,
          height: sh,
          border: '1px solid #1976D2',
          pointerEvents: 'none',
        }}
      />
      {/* Handles */}
      {showHandles && handles.map((h) => {
        const pos = HANDLE_POSITIONS[h];
        const hx = sx + sw * pos.x - HANDLE_SIZE_PX / 2;
        const hy = sy + sh * pos.y - HANDLE_SIZE_PX / 2;
        return (
          <div
            key={h}
            data-testid={`handle-${h}`}
            aria-label={HANDLE_LABELS[h]}
            role="button"
            style={{
              position: 'absolute',
              left: hx,
              top: hy,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              background: '#fff',
              border: '1px solid #1976D2',
              pointerEvents: 'auto',
              cursor: getCursor(h),
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onHandlePointerDown(e, h);
            }}
          />
        );
      })}
    </div>
  );
}

function getCursor(h: Handle): string {
  switch (h) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
  }
}
