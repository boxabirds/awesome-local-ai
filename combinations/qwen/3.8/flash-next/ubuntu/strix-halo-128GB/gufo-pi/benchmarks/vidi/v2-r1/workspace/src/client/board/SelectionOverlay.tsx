import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
  /** Whether to show handles (true if any selected type is resizable) */
  resizable: boolean;
}

const ALL_HANDLES: Array<{ handle: Handle; label: string; xFrac: number; yFrac: number }> = [
  { handle: 'nw', label: 'Resize top-left', xFrac: 0, yFrac: 0 },
  { handle: 'n', label: 'Resize top', xFrac: 0.5, yFrac: 0 },
  { handle: 'ne', label: 'Resize top-right', xFrac: 1, yFrac: 0 },
  { handle: 'e', label: 'Resize right', xFrac: 1, yFrac: 0.5 },
  { handle: 'se', label: 'Resize bottom-right', xFrac: 1, yFrac: 1 },
  { handle: 's', label: 'Resize bottom', xFrac: 0.5, yFrac: 1 },
  { handle: 'sw', label: 'Resize bottom-left', xFrac: 0, yFrac: 1 },
  { handle: 'w', label: 'Resize left', xFrac: 0, yFrac: 0.5 },
];

const HORIZONTAL_HANDLES: Array<{ handle: Handle; label: string; xFrac: number; yFrac: number }> = [
  { handle: 'e', label: 'Resize right', xFrac: 1, yFrac: 0.5 },
  { handle: 'w', label: 'Resize left', xFrac: 0, yFrac: 0.5 },
];

/**
 * Selection overlay: per-object outlines and a bounding box with 8 resize handles.
 * Rendered in the world layer so it moves with the board.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
  resizable,
}: SelectionOverlayProps): JSX.Element | null {
  if (ids.size === 0) return null;

  // Get the rects of selected objects
  const selectedObjects = snapshot.filter((obj) => ids.has(obj.id));
  if (selectedObjects.length === 0) return null;

  const rects = selectedObjects.map((obj) => objectBounds(obj));
  const boundingBox = unionRects(rects);
  if (!boundingBox) return null;

  const zoom = camera.zoom || 1;
  const handleSize = HANDLE_SIZE_PX / zoom; // Screen-space size in world units

  // Determine if all selected objects have horizontal-only handles
  const allHorizontal = selectedObjects.every((obj) => {
    const spec = getObjectType(obj.type);
    return spec?.handles === 'horizontal';
  });
  const handlePositions = allHorizontal ? HORIZONTAL_HANDLES : ALL_HANDLES;

  return (
    <>
      {/* Per-object outlines */}
      {selectedObjects.map((obj) => {
        const bounds = objectBounds(obj);
        return (
          <div
            key={`outline-${obj.id}`}
            className="selection-outline"
            data-testid="selection-outline"
            data-outline-id={obj.id}
            style={{
              position: 'absolute',
              left: bounds.x,
              top: bounds.y,
              width: bounds.width,
              height: bounds.height,
              border: `1px solid #1976D2`,
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        );
      })}

      {/* Bounding box */}
      <div
        className="selection-bounding-box"
        data-testid="selection-bounding-box"
        style={{
          position: 'absolute',
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
          border: `1px solid #1976D2`,
          pointerEvents: 'none',
          zIndex: 10000,
        }}
      >
        {/* Handles (only if resizable) */}
        {resizable &&
          handlePositions.map(({ handle, label, xFrac, yFrac }) => (
            <div
              key={handle}
              className="selection-handle"
              data-testid={`handle-${handle}`}
              aria-label={label}
              role="button"
              style={{
                position: 'absolute',
                left: `${xFrac * 100}%`,
                top: `${yFrac * 100}%`,
                width: handleSize,
                height: handleSize,
                marginLeft: -handleSize / 2,
                marginTop: -handleSize / 2,
                background: 'white',
                border: '1px solid #1976D2',
                cursor: getCursor(handle),
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
            />
          ))}
      </div>
    </>
  );
}

function getCursor(handle: Handle): string {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
  }
}
