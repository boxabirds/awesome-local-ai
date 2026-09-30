import { objectBounds, type ObjectSnapshot } from '@shared/board-model';
import { unionRects } from '@shared/geometry';
import type { Handle } from '@shared/geometry';
import { HANDLE_SIZE_PX } from '@shared/config';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HANDLE_META: Record<Handle, { dx: number; dy: number; cursor: string; label: string }> = {
  nw: { dx: 0, dy: 0, cursor: 'nwse-resize', label: 'top-left' },
  n: { dx: 0.5, dy: 0, cursor: 'ns-resize', label: 'top' },
  ne: { dx: 1, dy: 0, cursor: 'nesw-resize', label: 'top-right' },
  e: { dx: 1, dy: 0.5, cursor: 'ew-resize', label: 'right' },
  se: { dx: 1, dy: 1, cursor: 'nwse-resize', label: 'bottom-right' },
  s: { dx: 0.5, dy: 1, cursor: 'ns-resize', label: 'bottom' },
  sw: { dx: 0, dy: 1, cursor: 'nesw-resize', label: 'bottom-left' },
  w: { dx: 0, dy: 0.5, cursor: 'ew-resize', label: 'left' },
};

const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: React.PointerEvent, handle: Handle) => void;
}

/**
 * Story 7: bounding box around the whole selection with 8 resize handles.
 *
 * The box and handles are drawn in SCREEN space: handles stay
 * HANDLE_SIZE_PX on screen at any zoom. Handles are hidden when no selected
 * type is resizable. Per-object outlines are rendered by the objects
 * themselves via `data-selected`.
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  const bounds = unionRects(selected.map(objectBounds));
  if (!bounds) return null;

  const resizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  if (!resizable) return null;

  const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const w = bounds.width * camera.zoom;
  const h = bounds.height * camera.zoom;

  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1001 }}
    >
      <div
        data-testid="selection-bounds"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          width: w,
          height: h,
          border: '1px solid #2196F3',
          pointerEvents: 'none',
        }}
      />
      {ALL_HANDLES.map((handle) => {
        const meta = HANDLE_META[handle];
        const hx = topLeft.x + w * meta.dx;
        const hy = topLeft.y + h * meta.dy;
        return (
          <div
            key={handle}
            role="button"
            tabIndex={-1}
            aria-label={`Resize ${meta.label}`}
            data-testid={`resize-handle-${handle}`}
            data-handle={handle}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
            style={{
              position: 'absolute',
              left: hx - HANDLE_SIZE_PX / 2,
              top: hy - HANDLE_SIZE_PX / 2,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              backgroundColor: '#fff',
              border: '1px solid #2196F3',
              borderRadius: 1,
              cursor: meta.cursor,
              pointerEvents: 'auto',
            }}
          />
        );
      })}
    </div>
  );
}
