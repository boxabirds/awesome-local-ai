import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HANDLES: Array<{ handle: Handle; label: string }> = [
  { handle: 'nw', label: 'Resize top-left' },
  { handle: 'n', label: 'Resize top' },
  { handle: 'ne', label: 'Resize top-right' },
  { handle: 'e', label: 'Resize right' },
  { handle: 'se', label: 'Resize bottom-right' },
  { handle: 's', label: 'Resize bottom' },
  { handle: 'sw', label: 'Resize bottom-left' },
  { handle: 'w', label: 'Resize left' }
];

function anchor(box: Rect, handle: Handle): { left: number; top: number } {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  return {
    left: handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : midX,
    top: handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : midY
  };
}

export interface SelectionOverlayProps {
  objects: readonly ObjectSnapshot[];
  camera: Camera;
  selectedIds: ReadonlySet<string>;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

// Bounding box and resize handles for the selection, rendered in screen
// space so handles keep their pixel size at every zoom level. Hidden while
// no selected type is resizable.
export function SelectionOverlay({
  objects,
  camera,
  selectedIds,
  onHandlePointerDown
}: SelectionOverlayProps): JSX.Element | null {
  const boxes: Rect[] = [];
  let resizable = false;
  for (const obj of objects) {
    if (!selectedIds.has(obj.id)) continue;
    const spec = getObjectType(obj.type);
    if (spec === undefined) continue;
    boxes.push(objectBounds(obj));
    if (spec.resizable) resizable = true;
  }
  const union = unionRects(boxes);
  if (union === null || !resizable) return null;
  const topLeft = worldToScreen(camera, { x: union.x, y: union.y });
  const bottomRight = worldToScreen(camera, {
    x: union.x + union.width,
    y: union.y + union.height
  });
  const box: Rect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y
  };
  return (
    <div className="selection-overlay" data-testid="selection-overlay" aria-hidden="false">
      <div
        className="selection-box"
        data-testid="selection-box"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      />
      {HANDLES.map(({ handle, label }) => {
        const p = anchor(box, handle);
        return (
          <button
            key={handle}
            type="button"
            aria-label={label}
            className={`selection-handle selection-handle--${handle}`}
            data-handle={handle}
            style={{
              left: p.left - HANDLE_SIZE_PX / 2,
              top: p.top - HANDLE_SIZE_PX / 2,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button !== 0) return;
              onHandlePointerDown(e, handle);
            }}
          />
        );
      })}
    </div>
  );
}
