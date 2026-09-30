import { type ReactElement, type CSSProperties } from 'react';
import type { ObjectSnapshot } from '@shared/board-model';
import { objectBounds } from '@shared/board-model';
import { unionRects, type Handle } from '@shared/geometry';
import { type Camera, worldToScreen } from '@client/canvas/camera';
import { HANDLE_SIZE_PX } from '@shared/config';
import { getObjectType } from '@client/objects/registry';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

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

interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): ReactElement | null {
  if (ids.size === 0) return null;

  // Collect bounds of selected objects that exist
  const selectedObjs = snapshot.filter((o) => ids.has(o.id));
  if (selectedObjs.length === 0) return null;

  const rects = selectedObjs.map((o) => objectBounds(o));
  const boundingBox = unionRects(rects);
  if (!boundingBox) return null;

  // Check if any selected type is resizable
  const anyResizable = selectedObjs.some((o) => {
    const spec = getObjectType(o.type);
    return spec?.resizable;
  });

  // Convert bounding box to screen coordinates
  const topLeft = worldToScreen(camera, { x: boundingBox.x, y: boundingBox.y });
  const bottomRight = worldToScreen(camera, {
    x: boundingBox.x + boundingBox.width,
    y: boundingBox.y + boundingBox.height,
  });

  const screenW = bottomRight.x - topLeft.x;
  const screenH = bottomRight.y - topLeft.y;

  const boxStyle: CSSProperties = {
    position: 'fixed',
    left: topLeft.x,
    top: topLeft.y,
    width: screenW,
    height: screenH,
    border: '1px solid #1a73e8',
    pointerEvents: 'none',
    zIndex: 30,
  };

  return (
    <>
      {/* Per-object outlines */}
      {selectedObjs.map((obj) => {
        const bounds = objectBounds(obj);
        const tl = worldToScreen(camera, { x: bounds.x, y: bounds.y });
        const br = worldToScreen(camera, {
          x: bounds.x + bounds.width,
          y: bounds.y + bounds.height,
        });
        return (
          <div
            key={obj.id}
            data-outline={obj.id}
            style={{
              position: 'fixed',
              left: tl.x,
              top: tl.y,
              width: br.x - tl.x,
              height: br.y - tl.y,
              outline: '1px solid #1a73e8',
              pointerEvents: 'none',
              zIndex: 29,
            }}
          />
        );
      })}

      {/* Bounding box */}
      <div data-testid="selection-bounding-box" style={boxStyle}>
        {/* 8 handles */}
        {anyResizable &&
          HANDLES.map((handle) => {
            const pos = getHandlePosition(handle, topLeft, bottomRight);
            const handleStyle: CSSProperties = {
              position: 'absolute',
              left: pos.x - HANDLE_SIZE_PX / 2,
              top: pos.y - HANDLE_SIZE_PX / 2,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              backgroundColor: '#fff',
              border: '1px solid #1a73e8',
              cursor: getHandleCursor(handle),
              pointerEvents: 'auto',
            };
            return (
              <div
                key={handle}
                data-testid={`handle-${handle}`}
                aria-label={HANDLE_LABELS[handle]}
                role="button"
                style={handleStyle}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onHandlePointerDown(e.nativeEvent as PointerEvent, handle);
                }}
              />
            );
          })}
      </div>
    </>
  );
}

function getHandlePosition(
  handle: Handle,
  tl: { x: number; y: number },
  br: { x: number; y: number },
): { x: number; y: number } {
  const cx = (tl.x + br.x) / 2;
  const cy = (tl.y + br.y) / 2;
  switch (handle) {
    case 'nw': return { x: tl.x, y: tl.y };
    case 'n': return { x: cx, y: tl.y };
    case 'ne': return { x: br.x, y: tl.y };
    case 'e': return { x: br.x, y: cy };
    case 'se': return { x: br.x, y: br.y };
    case 's': return { x: cx, y: br.y };
    case 'sw': return { x: tl.x, y: br.y };
    case 'w': return { x: tl.x, y: cy };
  }
}

function getHandleCursor(handle: Handle): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
  }
}
