import type { Camera } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import { unionRects, type Handle } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';

/**
 * Selection outline (story 7, sel.outline).
 *
 * Renders the blue bounding box of the selection (union of the selected
 * objects' bounds) in screen space, with 8 square resize handles
 * (HANDLE_SIZE_PX, constant on screen at any zoom). Handles carry accessible
 * names ("Resize top-left", …) and delegate pointerdown to the transform
 * gesture. Handles are hidden when the selected types are not resizable.
 */

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

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

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): React.ReactElement | null {
  const selected = snapshot.filter((o) => ids.has(o.id) && getObjectType(o.type));
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const resizable = selected.some((o) => getObjectType(o.type)?.resizable);

  const left = (box.x - camera.x) * camera.zoom;
  const top = (box.y - camera.y) * camera.zoom;
  const w = box.width * camera.zoom;
  const h = box.height * camera.zoom;
  const s = HANDLE_SIZE_PX;

  const positions: Record<Handle, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    n: { x: w / 2, y: 0 },
    ne: { x: w, y: 0 },
    e: { x: w, y: h / 2 },
    se: { x: w, y: h },
    s: { x: w / 2, y: h },
    sw: { x: 0, y: h },
    w: { x: 0, y: h / 2 },
  };

  return (
    <div
      data-testid="selection-overlay"
      style={{
        position: 'fixed',
        left,
        top,
        width: w,
        height: h,
        pointerEvents: 'none',
        zIndex: 25,
        outline: '1px solid #1565C0',
        boxSizing: 'border-box',
      }}
    >
      {resizable &&
        HANDLES.map((handle) => {
          const p = positions[handle];
          return (
            <div
              key={handle}
              role="button"
              aria-label={`Resize ${HANDLE_LABELS[handle]}`}
              data-testid={`resize-handle-${handle}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e.nativeEvent, handle);
              }}
              style={{
                position: 'absolute',
                left: p.x - s / 2,
                top: p.y - s / 2,
                width: s,
                height: s,
                background: '#fff',
                border: '1px solid #1565C0',
                cursor: HANDLE_CURSORS[handle],
                pointerEvents: 'auto',
                boxSizing: 'border-box',
              }}
            />
          );
        })}
    </div>
  );
}
