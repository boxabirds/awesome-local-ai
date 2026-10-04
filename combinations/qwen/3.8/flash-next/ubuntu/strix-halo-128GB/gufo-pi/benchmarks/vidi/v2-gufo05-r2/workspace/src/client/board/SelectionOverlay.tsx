import type { PointerEvent as ReactPointerEvent } from 'react';

import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLE_LABELS, type Handle, type Rect } from '../../shared/geometry';

export interface SelectionOverlayProps {
  /** The selection's bounding box in board units; nothing when it is null. */
  box: Rect | null;
  zoom: number;
  /**
   * The handles to draw. An object type that cannot be resized gets none, and a
   * story that adds a type draws its own handles by passing a different list.
   */
  handles: readonly Handle[];
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

/**
 * Where a handle's centre sits, measured from the top-left of the selection box.
 * The outline element is already placed at that corner, so a handle written in the
 * box's own board coordinates would land a whole box away from the corner it is for.
 */
function anchor(box: Rect, handle: Handle): { x: number; y: number } {
  return {
    x: handle.includes('w') ? 0 : handle.includes('e') ? box.width : box.width / 2,
    y: handle.includes('n') ? 0 : handle.includes('s') ? box.height : box.height / 2,
  };
}

/**
 * The one selection outline for every object type (design key decision 6): a box
 * around what is selected, with a handle on each corner and edge.
 *
 * It is drawn inside the world layer, so it is positioned in board units like the
 * objects it surrounds and can never drift from them; only the handles are divided
 * by the zoom to stay `HANDLE_SIZE_PX` on screen at any scale. It is `aria-hidden`
 * because it carries no information a screen reader cannot get from the selection
 * announcement, and it never captures a pointer outside a handle.
 */
export function SelectionOverlay({
  box,
  zoom,
  handles,
  onHandlePointerDown,
}: SelectionOverlayProps) {
  if (!box) return null;
  const size = HANDLE_SIZE_PX / (zoom || 1);
  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      aria-hidden="true"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {handles.map((handle) => {
        const point = anchor(box, handle);
        return (
          <div
            key={handle}
            className={`selection-handle selection-handle--${handle}`}
            data-resize-handle={handle}
            data-testid={`resize-handle-${handle}`}
            aria-label={`Resize ${HANDLE_LABELS[handle]}`}
            title={`Resize ${HANDLE_LABELS[handle]}`}
            style={{
              left: point.x - size / 2,
              top: point.y - size / 2,
              width: size,
              height: size,
            }}
            onPointerDown={(event) => onHandlePointerDown(event, handle)}
          />
        );
      })}
    </div>
  );
}
