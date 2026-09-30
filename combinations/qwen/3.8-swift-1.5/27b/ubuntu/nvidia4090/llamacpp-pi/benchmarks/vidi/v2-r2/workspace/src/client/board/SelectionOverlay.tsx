import type { ReactElement } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType, typeHandles } from '../objects/registry';

interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HANDLES: { handle: Handle; label: string; cursor: string }[] = [
  { handle: 'nw', label: 'top-left', cursor: 'nwse-resize' },
  { handle: 'n', label: 'top', cursor: 'ns-resize' },
  { handle: 'ne', label: 'top-right', cursor: 'nesw-resize' },
  { handle: 'e', label: 'right', cursor: 'ew-resize' },
  { handle: 'se', label: 'bottom-right', cursor: 'nwse-resize' },
  { handle: 's', label: 'bottom', cursor: 'ns-resize' },
  { handle: 'sw', label: 'bottom-left', cursor: 'nesw-resize' },
  { handle: 'w', label: 'left', cursor: 'ew-resize' },
];

function handleCenter(box: ScreenRect, handle: Handle): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (handle) {
    case 'nw':
      return { x: box.x, y: box.y };
    case 'n':
      return { x: cx, y: box.y };
    case 'ne':
      return { x: box.x + box.width, y: box.y };
    case 'e':
      return { x: box.x + box.width, y: cy };
    case 'se':
      return { x: box.x + box.width, y: box.y + box.height };
    case 's':
      return { x: cx, y: box.y + box.height };
    case 'sw':
      return { x: box.x, y: box.y + box.height };
    case 'w':
      return { x: box.x, y: cy };
  }
}

/**
 * Screen-space overlay for the current selection (story 7, sel.ui): a bounding
 * box around the selection plus 8 resize handles (only when the selection is
 * resizable). Rendered OUTSIDE the world layer so handle size is constant in
 * screen px. Individual object outlines are the object components' own
 * `data-selected` style.
 */
export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}): ReactElement | null {
  if (ids.size === 0) return null;

  const rects: Rect[] = [];
  let resizable = false;
  for (const obj of snapshot) {
    if (!ids.has(obj.id)) continue;
    rects.push(objectBounds(obj));
    const spec = getObjectType(obj.type);
    if (spec?.resizable) resizable = true;
  }
  const bounds = unionRects(rects);
  if (!bounds) return null;

  // A single text object shows only the horizontal (w/e) handles; its height
  // is measured from content and never set by a drag (story 9).
  let handleMode: 'all' | 'horizontal' = 'all';
  if (ids.size === 1) {
    const single = snapshot.find((o) => ids.has(o.id));
    if (single) handleMode = typeHandles(single.type);
  }
  const activeHandles =
    handleMode === 'horizontal' ? HANDLES.filter((h) => h.handle === 'w' || h.handle === 'e') : HANDLES;

  const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const box: ScreenRect = {
    x: topLeft.x,
    y: topLeft.y,
    width: bounds.width * camera.zoom,
    height: bounds.height * camera.zoom,
  };

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 900 }}>
      <div
        data-testid="selection-bounds"
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          border: '1px solid #2563eb',
          pointerEvents: 'none',
        }}
      />
      {resizable &&
        activeHandles.map(({ handle, label, cursor }) => {
          const c = handleCenter(box, handle);
          return (
            <div
              key={handle}
              data-testid={`resize-handle-${handle}`}
              role="button"
              aria-label={`Resize ${label}`}
              onPointerDown={(e) => onHandlePointerDown(e, handle)}
              style={{
                position: 'absolute',
                left: c.x - HANDLE_SIZE_PX / 2,
                top: c.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                background: '#ffffff',
                border: '1px solid #2563eb',
                boxSizing: 'border-box',
                pointerEvents: 'auto',
                cursor,
              }}
            />
          );
        })}
    </div>
  );
}
