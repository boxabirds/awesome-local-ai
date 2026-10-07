import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { objectBounds, type ObjectSnapshot, type Rect } from '../../shared/board-model.js';
import { HANDLE_SIZE_PX } from '../../shared/config.js';
import { unionRects, HANDLES, type Handle } from '../../shared/geometry.js';
import { worldToScreen } from '../canvas/camera.js';
import { useCameraContext } from '../canvas/useCamera.js';
import { getObjectType } from './registry.js';

/**
 * The selection overlay (design anchor: `src/client/objects/SelectionOverlay.tsx`).
 *
 * An outline per selected object plus eight resize handles around the whole
 * selection's bounding box, drawn in **screen space** (Key decision 5): the
 * outlines sit on top of the world layer but live in a fixed overlay, so their
 * thickness stays one crisp CSS pixel and the handles stay 8 px at every zoom -
 * without the per-object counter-scaling the alternative (drawing them inside the
 * scaled world layer) would need on every piece of chrome.
 *
 * The overlay is deliberately dumb: it never writes the document, and starting a
 * handle drag is delegated to `onHandlePointerDown` (the transform gesture), so a
 * group resize needs no per-type code here. The only per-type question it does
 * ask - "can these objects be resized at all?" - it asks the object registry
 * (Key decision 3), never with a type literal.
 */

export interface SelectionOverlayProps {
  /** The full board snapshot; only the selected objects are drawn. */
  snapshot: readonly ObjectSnapshot[];
  /** The selected ids. */
  ids: ReadonlySet<string>;
  /** Start a resize of the whole selection from a handle. */
  onHandlePointerDown(event: ReactPointerEvent, handle: Handle): void;
}

/** Where a handle sits on a rectangle, as fractions of its width and height. */
const HANDLE_ANCHORS: Record<Handle, { fx: number; fy: number }> = {
  nw: { fx: 0, fy: 0 },
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 },
};

/** The accessible name half of "Resize <position>". */
const HANDLE_NAMES: Record<Handle, string> = {
  nw: 'top-left corner',
  n: 'top edge',
  ne: 'top-right corner',
  e: 'right edge',
  se: 'bottom-right corner',
  s: 'bottom edge',
  sw: 'bottom-left corner',
  w: 'left edge',
};

/** The cursor for each handle. */
const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

/**
 * The two side handles, and the whole set for anything else. A type that says its
 * handles are `'horizontal'` has a height that is not its own to keep - a piece of
 * text is as tall as the lines it needs at the width it has - so offering a top or
 * bottom handle would promise a drag that the object refuses to do.
 */
const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

/** The world rectangle a screen-space box covers, in board-surface coordinates. */
interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function toScreenRect(camera: { x: number; y: number; zoom: number }, rect: Rect): ScreenRect {
  const origin = worldToScreen(camera, { x: rect.x, y: rect.y });
  return {
    left: origin.x,
    top: origin.y,
    width: rect.width * camera.zoom,
    height: rect.height * camera.zoom,
  };
}

export default function SelectionOverlay({
  snapshot,
  ids,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  const camera = useCameraContext().camera;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  const bounds = selected.map((object) => objectBounds(object));
  const box = unionRects(bounds);
  if (!box) return null;

  // The handles are the *selection's*, so they show when any selected object's
  // type can be resized at all - not "is this a sticky".
  const showHandles = selected.some((object) => getObjectType(object.type)?.resizable === true);
  // And they are the selection's as a whole, so the reduced set appears only when
  // every resizable type in it wants it. Text alone is dragged sideways; text
  // together with a note is a group, and a group has corners (`text.mixed_handles`).
  const resizable = selected.filter((object) => getObjectType(object.type)?.resizable === true);
  const sideways =
    resizable.length > 0 &&
    resizable.every((object) => getObjectType(object.type)?.handles === 'horizontal');
  const handles = sideways ? HORIZONTAL_HANDLES : HANDLES;

  const screenBox = toScreenRect(camera, box);
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div className="selection-overlay" data-testid="selection-overlay" aria-hidden="true">
      {bounds.map((rect, index) => {
        const screen = toScreenRect(camera, rect);
        return (
          <div
            key={selected[index].id}
            className="selection-outline"
            data-testid="selection-outline"
            data-object-id={selected[index].id}
            style={{
              left: `${screen.left}px`,
              top: `${screen.top}px`,
              width: `${screen.width}px`,
              height: `${screen.height}px`,
            }}
          />
        );
      })}

      {showHandles
        ? handles.map((handle) => {
            const anchor = HANDLE_ANCHORS[handle];
            const left = screenBox.left + anchor.fx * screenBox.width - half;
            const top = screenBox.top + anchor.fy * screenBox.height - half;
            return (
              <div
                key={handle}
                className={`resize-handle resize-handle--${handle}`}
                data-testid="resize-handle"
                data-handle={handle}
                role="button"
                aria-label={`Resize ${HANDLE_NAMES[handle]}`}
                style={{
                  left: `${left}px`,
                  top: `${top}px`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                  cursor: HANDLE_CURSORS[handle],
                }}
                onPointerDown={(event) => onHandlePointerDown(event, handle)}
              />
            );
          })
        : null}
    </div>
  );
}
