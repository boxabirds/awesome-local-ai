// What a selection draws: the bounding box with its eight resize handles, and
// the marquee rectangle while it is being dragged.
//
// Both live OUTSIDE the world layer on purpose. The world is scaled by zoom;
// a selection drawn inside it would grow and shrink its outline and handles
// with the zoom, and handles must stay exactly HANDLE_SIZE_PX screen pixels -
// so these components take the world rect, convert it through the camera
// themselves, and sit in screen space like the toolbars do. The same
// worldToScreen the grid and the notes already agree on keeps the box glued
// to the objects through every pan and zoom without a single measured pixel.

import { type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, type Handle, type Rect } from '../../shared/geometry';
import { useBoardCamera } from '../canvas/CameraProvider';
import { worldToScreen, type Camera } from '../canvas/camera';

/** Screen-space box for a world rect: where an overlay draws. */
export function screenBox(camera: Camera, rect: Rect): Rect {
  const from = worldToScreen(camera, { x: rect.x, y: rect.y });
  const to = worldToScreen(camera, { x: rect.x + rect.width, y: rect.y + rect.height });
  return { x: from.x, y: from.y, width: to.x - from.x, height: to.y - from.y };
}

/** Where a handle's centre sits on a screen box, by handle name. */
function handleCentre(box: Rect, handle: Handle): { x: number; y: number } {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  return {
    x: handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : midX,
    y: handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : midY,
  };
}

/** The spelled-out direction, for the handles' accessible names. */
const HANDLE_NAMES: Record<Handle, string> = {
  nw: 'northwest',
  n: 'north',
  ne: 'northeast',
  e: 'east',
  se: 'southeast',
  s: 'south',
  sw: 'southwest',
  w: 'west',
};

export interface SelectionOverlayProps {
  /** The selection's bounding box, in world units. */
  rect: Rect;
  /** True while the gesture is transforming: the box follows the objects. */
  transforming: boolean;
  onHandlePointerDown(handle: Handle, event: ReactPointerEvent<HTMLElement>): void;
}

export function SelectionOverlay({ rect, transforming, onHandlePointerDown }: SelectionOverlayProps): JSX.Element {
  const { camera } = useBoardCamera();
  const box = screenBox(camera, rect);
  const inset = HANDLE_SIZE_PX / 2;

  return (
    <div
      data-testid="selection-box"
      data-transforming={transforming}
      className={`selection-box${transforming ? ' is-transforming' : ''}`}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {HANDLES.map((handle) => {
        const at = handleCentre(box, handle);
        return (
          <div
            key={handle}
            data-testid={`resize-handle-${handle}`}
            data-handle={handle}
            className={`resize-handle resize-handle--${handle}`}
            aria-label={`Resize ${HANDLE_NAMES[handle]}`}
            // the handles ride inside the box, which already sits at the box's
            // screen place; their own offsets are relative to it
            style={{
              left: at.x - box.x - inset,
              top: at.y - box.y - inset,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
            }}
            onPointerDown={(event) => onHandlePointerDown(handle, event)}
          />
        );
      })}
    </div>
  );
}

/** The marquee: the rectangle the pointer draws across empty board space. */
export function MarqueeRect({ rect }: { rect: Rect }): JSX.Element {
  const { camera } = useBoardCamera();
  const box = screenBox(camera, rect);
  return (
    <div
      data-testid="marquee"
      className="marquee-rect"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    />
  );
}
