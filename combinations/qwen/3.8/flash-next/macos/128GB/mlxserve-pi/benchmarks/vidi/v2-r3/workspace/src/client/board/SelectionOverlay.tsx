import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Rect, Handle } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  /** The set of selected object ids. */
  ids: ReadonlySet<string>;
  /** Current snapshot for looking up object bounds. */
  snapshot: readonly ObjectSnapshot[];
  /** Camera for world-to-screen conversion. */
  camera: Camera;
  /** Called when a resize handle is pressed. */
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
}

const HANDLES: readonly { handle: Handle; label: string; cursor: string }[] = [
  { handle: 'nw', label: 'Resize top-left', cursor: 'nw-resize' },
  { handle: 'n', label: 'Resize top', cursor: 'n-resize' },
  { handle: 'ne', label: 'Resize top-right', cursor: 'ne-resize' },
  { handle: 'e', label: 'Resize right', cursor: 'e-resize' },
  { handle: 'se', label: 'Resize bottom-right', cursor: 'se-resize' },
  { handle: 's', label: 'Resize bottom', cursor: 's-resize' },
  { handle: 'sw', label: 'Resize bottom-left', cursor: 'sw-resize' },
  { handle: 'w', label: 'Resize left', cursor: 'w-resize' },
];

/**
 * Renders the bounding box and 8 resize handles around the current selection.
 * Handles are positioned in screen space (fixed overlay) and sized HANDLE_SIZE_PX.
 * Hidden when no selected type is resizable.
 */
export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  if (ids.size === 0) return null;

  // Get rects of all selected objects
  const rects: Rect[] = [];
  let anyResizable = false;

  for (const id of ids) {
    const obj = snapshot.find((s) => s.id === id);
    if (obj === undefined) continue;
    rects.push(objectBounds(obj));
    const spec = getObjectType(obj.type);
    if (spec !== undefined && spec.resizable) anyResizable = true;
  }

  if (rects.length === 0) return null;

  const boundingBox = unionRects(rects);
  if (boundingBox === null) return null;

  // Convert world rect to screen position
  const screenLeft = (boundingBox.x - camera.x) * camera.zoom;
  const screenTop = (boundingBox.y - camera.y) * camera.zoom;
  const screenWidth = boundingBox.width * camera.zoom;
  const screenHeight = boundingBox.height * camera.zoom;

  const half = HANDLE_SIZE_PX / 2;

  // Handle positions (as fractions of the bounding box)
  const positions: Record<Handle, { left: number; top: number }> = {
    nw: { left: screenLeft, top: screenTop },
    n: { left: screenLeft + screenWidth / 2, top: screenTop },
    ne: { left: screenLeft + screenWidth, top: screenTop },
    e: { left: screenLeft + screenWidth, top: screenTop + screenHeight / 2 },
    se: { left: screenLeft + screenWidth, top: screenTop + screenHeight },
    s: { left: screenLeft + screenWidth / 2, top: screenTop + screenHeight },
    sw: { left: screenLeft, top: screenTop + screenHeight },
    w: { left: screenLeft, top: screenTop + screenHeight / 2 },
  };

  return (
    <div className="selection-overlay" data-testid="selection-overlay">
      {/* Bounding box */}
      <div
        className="selection-bounding-box"
        data-testid="selection-bounding-box"
        style={{
          position: 'fixed',
          left: `${screenLeft}px`,
          top: `${screenTop}px`,
          width: `${screenWidth}px`,
          height: `${screenHeight}px`,
        }}
      />
      {/* Resize handles (only when resizable) */}
      {anyResizable && HANDLES.map(({ handle, label, cursor }) => {
        const pos = positions[handle];
        return (
          <div
            key={handle}
            className={`resize-handle resize-handle-${handle}`}
            data-testid={`resize-handle-${handle}`}
            data-handle={handle}
            aria-label={label}
            style={{
              position: 'fixed',
              left: `${pos.left - half}px`,
              top: `${pos.top - half}px`,
              width: `${HANDLE_SIZE_PX}px`,
              height: `${HANDLE_SIZE_PX}px`,
              cursor,
              '--handle-size': `${HANDLE_SIZE_PX}px`,
            } as React.CSSProperties}
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
