/**
 * SelectionOverlay: draws per-object outlines, bounding box, and 8 resize handles
 * in screen space.
 */
import type { PointerEvent as ReactPointerEvent } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLDivElement>, handle: Handle): void;
}

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): React.JSX.Element | null {
  if (ids.size === 0) return null;

  const selectedObjects = snapshot.filter((o) => ids.has(o.id));
  if (selectedObjects.length === 0) return null;

  // Check if any selected type is resizable
  const anyResizable = selectedObjects.some((o) => {
    const spec = getObjectType(o.type);
    return spec?.resizable ?? false;
  });

  const rects = selectedObjects.map(objectBounds);
  const bbox = unionRects(rects);
  if (!bbox) return null;

  // Convert bounding box to screen coordinates
  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const bottomRight = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });

  const screenRect: Rect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };

  const handlePositions: Record<Handle, { x: number; y: number }> = {
    nw: { x: screenRect.x, y: screenRect.y },
    n: { x: screenRect.x + screenRect.width / 2, y: screenRect.y },
    ne: { x: screenRect.x + screenRect.width, y: screenRect.y },
    e: { x: screenRect.x + screenRect.width, y: screenRect.y + screenRect.height / 2 },
    se: { x: screenRect.x + screenRect.width, y: screenRect.y + screenRect.height },
    s: { x: screenRect.x + screenRect.width / 2, y: screenRect.y + screenRect.height },
    sw: { x: screenRect.x, y: screenRect.y + screenRect.height },
    w: { x: screenRect.x, y: screenRect.y + screenRect.height / 2 },
  };

  const cursors: Record<Handle, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
  };

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        left: screenRect.x,
        top: screenRect.y,
        width: screenRect.width,
        height: screenRect.height,
        pointerEvents: 'none',
      }}
    >
      {anyResizable
        ? HANDLES.map((h) => (
            <div
              key={h}
              className="selection-handle"
              data-testid={`handle-${h}`}
              aria-label={`Resize ${HANDLE_LABELS[h]}`}
              role="button"
              style={{
                position: 'absolute',
                left: handlePositions[h].x - screenRect.x - HANDLE_SIZE_PX / 2,
                top: handlePositions[h].y - screenRect.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                background: '#fff',
                border: '1.5px solid var(--selection-blue)',
                borderRadius: 1,
                cursor: cursors[h],
                pointerEvents: 'auto',
                zIndex: 10,
              }}
              onPointerDown={(e) => onHandlePointerDown(e, h)}
            />
          ))
        : null}
    </div>
  );
}
