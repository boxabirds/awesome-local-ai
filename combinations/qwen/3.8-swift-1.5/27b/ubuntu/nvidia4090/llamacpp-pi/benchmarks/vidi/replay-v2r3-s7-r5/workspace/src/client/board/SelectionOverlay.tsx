import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { worldToScreen, type Camera } from '../canvas/camera';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX } from '../../shared/config';

/**
 * Story 7: the selection overlay (sel.transform UI). The bounding box of the
 * selection in screen space, plus eight resize handles (HANDLE_SIZE_PX,
 * constant at every zoom). Handles are hidden while editing or when no
 * selected type is resizable.
 */

const HANDLES: Handle[] = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const CURSORS: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export interface SelectionOverlayProps {
  objects: readonly ObjectSnapshot[];
  selectedIds: ReadonlySet<string>;
  editingId: string | null;
  camera: Camera;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

function handleCenter(box: { left: number; top: number; right: number; bottom: number }, h: Handle) {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  switch (h) {
    case 'n':
      return { x: cx, y: box.top };
    case 'ne':
      return { x: box.right, y: box.top };
    case 'e':
      return { x: box.right, y: cy };
    case 'se':
      return { x: box.right, y: box.bottom };
    case 's':
      return { x: cx, y: box.bottom };
    case 'sw':
      return { x: box.left, y: box.bottom };
    case 'w':
      return { x: box.left, y: cy };
    case 'nw':
      return { x: box.left, y: box.top };
  }
}

export function SelectionOverlay({
  objects,
  selectedIds,
  editingId,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): React.ReactElement | null {
  if (selectedIds.size === 0) return null;

  const rects: Rect[] = [];
  let anyResizable = false;
  for (const obj of objects) {
    if (!selectedIds.has(obj.id)) continue;
    const spec = getObjectType(obj.type);
    if (!spec) continue;
    rects.push(objectBounds(obj));
    if (spec.resizable) anyResizable = true;
  }
  const box = unionRects(rects);
  if (!box) return null;

  const tl = worldToScreen(camera, { x: box.x, y: box.y });
  const br = worldToScreen(camera, { x: box.x + box.width, y: box.y + box.height });
  const screenBox = { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
  const showHandles = anyResizable && editingId === null;

  return (
    <div data-testid="selection-overlay" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 20 }}>
      <div
        data-testid="selection-box"
        style={{
          position: 'absolute',
          left: screenBox.left,
          top: screenBox.top,
          width: screenBox.right - screenBox.left,
          height: screenBox.bottom - screenBox.top,
          border: '1px solid #1565C0',
          borderRadius: 2,
        }}
      />
      {showHandles &&
        HANDLES.map((h) => {
          const c = handleCenter(screenBox, h);
          return (
            <div
              key={h}
              role="button"
              aria-label={`Resize ${h}`}
              data-testid={`resize-handle-${h}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onHandlePointerDown(e.nativeEvent, h);
              }}
              style={{
                position: 'absolute',
                left: c.x - HANDLE_SIZE_PX / 2,
                top: c.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                background: '#fff',
                border: '1px solid #1565C0',
                borderRadius: 2,
                cursor: CURSORS[h],
                pointerEvents: 'auto',
                touchAction: 'none',
              }}
            />
          );
        })}
    </div>
  );
}
