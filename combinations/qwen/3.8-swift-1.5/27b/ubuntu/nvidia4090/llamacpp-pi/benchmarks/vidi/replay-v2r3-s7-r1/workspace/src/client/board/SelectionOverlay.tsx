import { HANDLE_SIZE_PX } from '../../shared/config';
import type { Handle, Rect } from '../../shared/geometry';

const BOX_COLOR = '#1565C0';

const HANDLES: { handle: Handle; cursor: string }[] = [
  { handle: 'nw', cursor: 'nwse-resize' },
  { handle: 'n', cursor: 'ns-resize' },
  { handle: 'ne', cursor: 'nesw-resize' },
  { handle: 'e', cursor: 'ew-resize' },
  { handle: 'se', cursor: 'nwse-resize' },
  { handle: 's', cursor: 'ns-resize' },
  { handle: 'sw', cursor: 'nesw-resize' },
  { handle: 'w', cursor: 'ew-resize' },
];

function handleCenter(handle: Handle, box: Rect): { x: number; y: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  switch (handle) {
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
    case 'nw':
      return { x: box.x, y: box.y };
  }
}

export interface SelectionOverlayProps {
  /** The selection bounding box in world units. */
  box: Rect;
  zoom: number;
  /** Show the 8 resize handles (all selected objects must be resizable). */
  showHandles: boolean;
  canEdit: boolean;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

/**
 * Story 7: the selection bounding box (world layer) with 8 resize handles.
 * The handles are a constant HANDLE_SIZE_PX on screen, so their world size is
 * HANDLE_SIZE_PX / zoom (zoom-independent).
 */
export function SelectionOverlay({
  box,
  zoom,
  showHandles,
  canEdit,
  onHandlePointerDown,
}: SelectionOverlayProps): React.ReactElement {
  const handleSize = HANDLE_SIZE_PX / zoom;
  return (
    <div
      data-testid="selection-box"
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        border: `1.5px solid ${BOX_COLOR}`,
        pointerEvents: 'none',
        zIndex: 2147483647,
      }}
    >
      {showHandles &&
        canEdit &&
        HANDLES.map(({ handle, cursor }) => {
          const c = handleCenter(handle, box);
          return (
            <div
              key={handle}
              data-testid={`sel-handle-${handle}`}
              data-sel-handle
              role="button"
              aria-label={`Resize ${handle}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e.nativeEvent, handle);
              }}
              style={{
                position: 'absolute',
                // The handle is a child of the box (which is already placed at
                // box.x/box.y in world space), so use box-relative offsets.
                left: c.x - box.x - handleSize / 2,
                top: c.y - box.y - handleSize / 2,
                width: handleSize,
                height: handleSize,
                background: '#fff',
                border: `1.5px solid ${BOX_COLOR}`,
                cursor,
                pointerEvents: 'auto',
                boxSizing: 'border-box',
              }}
            />
          );
        })}
    </div>
  );
}
