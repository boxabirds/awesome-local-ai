import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  HANDLES,
  HANDLE_LABELS,
  unionRects,
  type Handle,
  type Rect,
} from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  /** The selected ids. */
  ids: ReadonlySet<string>;
  /** The board, to read the selected objects' rectangles. */
  snapshot: readonly ObjectSnapshot[];
  /** Camera, to place screen-space controls over world-space objects. */
  camera: Camera;
  /** Press on a handle: begin resizing. */
  onHandlePointerDown(event: ReactPointerEvent<HTMLDivElement> | PointerEvent, handle: Handle): void;
  /** The selection bar, anchored above the bounding box. */
  children?: ReactNode;
}

/** Where a handle sits on its box, as a fraction of the box (0/0.5/1). */
/** Distance from the top of the selection to the bar, in board units. */
const BAR_GAP_BOARD_UNITS = 8;

const HANDLE_POSITION: Record<Handle, { fx: number; fy: number }> = {
  nw: { fx: 0, fy: 0 },
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 },
};

/** Screen-space rectangle of a world rectangle. */
function toScreen(rect: Rect, camera: Camera) {
  const origin = worldToScreen(camera, { x: rect.x, y: rect.y });
  return {
    left: origin.x,
    top: origin.y,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

/**
 * The selection's on-screen furniture: a bounding box, eight resize handles and
 * the selection bar anchored above it.
 *
 * It is drawn in *screen* space, over the world layer, so handles stay
 * HANDLE_SIZE_PX at 25% and at 400% zoom. Individual objects draw their own
 * outline (`data-selected`); the box appears once two or more are selected,
 * because for one object the box and the object are the same rectangle.
 *
 * The layer itself is transparent to the pointer: panning and marqueeing keep
 * working everywhere except on a handle.
 */
export function SelectionOverlay(props: SelectionOverlayProps) {
  const { ids, snapshot, camera, onHandlePointerDown, children } = props;
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  const rects = selected.map((object) => objectBounds(object));
  const box = unionRects(rects);
  if (!box) return null;
  const screen = toScreen(box, camera);

  // Handles exist only if some selected type can be resized; one locked type in
  // the selection does not hide them for the others (they simply do not move).
  const resizable = selected.some((object) => getObjectType(object.type)?.resizable ?? false);

  const half = HANDLE_SIZE_PX / 2;
  // Story 2's rule, kept: the gap between the bar and the things it belongs to is
  // measured in board units, so on screen it grows and shrinks with the zoom, while
  // the bar itself keeps a constant screen size. Measuring it in screen pixels
  // would make the bar drift off the objects at 50% and collide with them at 400%.
  const barTop = screen.top - BAR_GAP_BOARD_UNITS * camera.zoom;

  return (
    <div className="selection-overlay" data-selection-overlay="">
      {selected.length > 1 ? (
        <div
          className="selection-bounds"
          data-selection-bounds=""
          style={{
            left: `${screen.left}px`,
            top: `${screen.top}px`,
            width: `${screen.width}px`,
            height: `${screen.height}px`,
          }}
        />
      ) : null}

      {resizable
        ? HANDLES.map((handle) => {
            const { fx, fy } = HANDLE_POSITION[handle];
            return (
              <div
                key={handle}
                className={`resize-handle resize-handle-${handle}`}
                data-resize-handle={handle}
                role="button"
                aria-label={HANDLE_LABELS[handle]}
                style={{
                  left: `${screen.left + screen.width * fx - half}px`,
                  top: `${screen.top + screen.height * fy - half}px`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                }}
                onPointerDown={(event) => {
                  // The handle is 8 pixels; capture keeps the drag alive when the
                  // pointer leaves it (the events then still reach the gesture, which
                  // listens on the window). Without capture, a fast drag off the edge
                  // hands the release to whatever is underneath.
                  try {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  } catch {
                    /* not supported (e.g. jsdom) */
                  }
                  onHandlePointerDown(event, handle);
                }}
              />
            );
          })
        : null}

      <div
        className="selection-bar-anchor"
        data-selection-bar-anchor=""
        style={{
          left: `${screen.left + screen.width / 2}px`,
          top: `${barTop}px`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
