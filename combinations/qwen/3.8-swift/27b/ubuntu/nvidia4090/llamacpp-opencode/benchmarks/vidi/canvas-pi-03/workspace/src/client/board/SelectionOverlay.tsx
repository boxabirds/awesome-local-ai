/**
 * Story 7: the selection bounding box with its 8 resize handles (sel.overlay).
 *
 * Rendered in SCREEN space (fixed positioning, screen coordinates) so the
 * outline and handles stay a constant size at any zoom level. Shown whenever
 * the selection is non-empty. Handles are shown only when at least one
 * selected type is resizable. Each handle is labelled for accessibility
 * ("Resize north", "Resize east-north-east", …) per sel.a11y.
 */
import type { JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot } from 'src/shared/board-model';
import {
  unionRects,
  HANDLES,
  HANDLE_LABELS,
  type Handle,
  type Rect,
} from 'src/shared/geometry';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX } from 'src/shared/config';

/** Union bounds of the selected objects (world units), null for an empty selection. */
export function selectionBounds(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): Rect | null {
  const rects: Rect[] = [];
  for (const o of snapshot) if (ids.has(o.id)) rects.push(objectBounds(o));
  return unionRects(rects);
}

/**
 * Position of a handle RELATIVE to the overlay container's top-left corner
 * (the handles are absolutely positioned inside the box, which is itself
 * placed at the box's screen top-left). Offsets range over [0,width]×[0,height].
 */
function handlePosition(h: Handle, box: Rect): { x: number; y: number } {
  const cx = box.width / 2;
  const cy = box.height / 2;
  switch (h) {
    case 'n':
      return { x: cx, y: 0 };
    case 'ne':
      return { x: box.width, y: 0 };
    case 'e':
      return { x: box.width, y: cy };
    case 'se':
      return { x: box.width, y: box.height };
    case 's':
      return { x: cx, y: box.height };
    case 'sw':
      return { x: 0, y: box.height };
    case 'w':
      return { x: 0, y: cy };
    case 'nw':
      return { x: 0, y: 0 };
  }
}

export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: React.PointerEvent<HTMLElement>, handle: Handle) => void;
}): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  const worldBox = selectionBounds(ids, snapshot);
  if (!worldBox) return null;

  const topLeft = worldToScreen(camera, { x: worldBox.x, y: worldBox.y });
  const bottomRight = worldToScreen(camera, { x: worldBox.x + worldBox.width, y: worldBox.y + worldBox.height });
  const box: Rect = { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };

  const resizable = snapshot.some((o) => ids.has(o.id) && getObjectType(o.type)?.resizable);

  return (
    <div
      data-testid="selection-overlay"
      aria-label="Selection"
      style={{
        position: 'fixed',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        border: '1.5px solid #1A73E8',
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      {resizable &&
        HANDLES.map((h) => {
          const p = handlePosition(h, box);
          return (
            <div
              key={h}
              data-testid="resize-handle"
              data-handle={h}
              role="button"
              aria-label={`Resize ${HANDLE_LABELS[h]}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, h);
              }}
              style={{
                position: 'absolute',
                left: p.x - HANDLE_SIZE_PX / 2,
                top: p.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                backgroundColor: '#FFFFFF',
                border: '1.5px solid #1A73E8',
                borderRadius: 2,
                cursor: handleCursor(h),
                pointerEvents: 'auto',
                boxSizing: 'border-box',
              }}
            />
          );
        })}
    </div>
  );
}

/** CSS cursor per handle (edge handles resize one axis only). */
function handleCursor(h: Handle): string {
  switch (h) {
    case 'n':
      return 'ns-resize';
    case 's':
      return 'ns-resize';
    case 'e':
      return 'ew-resize';
    case 'w':
      return 'ew-resize';
    case 'ne':
      return 'nesw-resize';
    case 'sw':
      return 'nesw-resize';
    case 'nw':
      return 'nwse-resize';
    case 'se':
      return 'nwse-resize';
  }
}
