/**
 * The box around a selection, and the eight handles that change its size.
 *
 * It is drawn in screen space, over the board rather than inside it: a selection of one sticky note
 * and a selection of twenty get the same one-pixel box and the same eight handles, whatever is
 * selected and whatever size they are. That is only possible because the box is the *union* of the
 * selected objects' bounds — the objects themselves draw their own outlines (`data-selected`), this
 * draws the one shape they make together.
 *
 * The handles are the resize gesture's door: they hand the pointer straight to `useTransformGesture`
 * and say nothing else, because where the objects end up is a question about all of them at once and
 * not about the handle that was pulled. When no type in the selection can be resized there are no
 * handles to pull, and the box says so by having none.
 */

import type { PointerEvent as ReactPointerEvent } from 'react';

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { isResizableType, handlesForObjects } from '../objects/registry';

export interface SelectionOverlayProps {
  /** What is selected. An empty selection draws nothing. */
  ids: ReadonlySet<string>;
  /** The board, which is where the selected objects' rectangles are. */
  snapshot: readonly ObjectSnapshot[];
  /** To put a world rectangle on the screen. */
  camera: Camera;
  /** A handle was pressed. The gesture decides what it means. */
  onHandlePointerDown(e: PointerEvent, h: Handle): void;
}

/** The order handles are drawn in, so the DOM order matches the box. */
const CORNERS_AND_EDGES: readonly Handle[] = HANDLES;

/**
 * The handles of a selection whose every resizable type is sized by what is written on it: the two on
 * its sides, and nothing else.
 *
 * A text object has a width a handle can change and a height that belongs to its lines, so a handle on
 * its top edge would be an offer this board cannot keep — the next keystroke would take it back.
 */
const SIDE_HANDLES: readonly Handle[] = ['w', 'e'];

/** `aria-label="Resize <position>"`, in the words a person would say to the person next to them. */
const HANDLE_LABELS: Record<Handle, string> = {
  n: 'north',
  ne: 'north-east',
  e: 'east',
  se: 'south-east',
  s: 'south',
  sw: 'south-west',
  w: 'west',
  nw: 'north-west',
};

/** Where a handle sits on a screen-space box, centred on the point it drags. */
const handleStyle = (box: Rect, handle: Handle): React.CSSProperties => {
  const half = HANDLE_SIZE_PX / 2;
  const left =
    handle === 'w' || handle === 'sw' || handle === 'nw'
      ? box.x - half
      : handle === 'e' || handle === 'se' || handle === 'ne'
        ? box.x + box.width - half
        : box.x + box.width / 2 - half;
  const top =
    handle === 'n' || handle === 'ne' || handle === 'nw'
      ? box.y - half
      : handle === 's' || handle === 'se' || handle === 'sw'
        ? box.y + box.height - half
        : box.y + box.height / 2 - half;
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${HANDLE_SIZE_PX}px`,
    height: `${HANDLE_SIZE_PX}px`,
    cursor: CURSORS[handle],
  };
};

/** The cursor a handle asks for, so a pull is suggested before the pull. */
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

export function SelectionOverlay(props: SelectionOverlayProps): React.JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length === 0) return null;

  const world = unionRects(selected.map((object) => objectBounds(object)));
  if (world === null) return null;

  // One object on each corner of the world box, scaled: that is the box on the screen.
  const origin = worldToScreen(camera, { x: world.x, y: world.y });
  const box: Rect = {
    x: origin.x,
    y: origin.y,
    width: world.width * camera.zoom,
    height: world.height * camera.zoom,
  };

  // Not one type in the selection can be resized: nothing to pull. An object of a type this build
  // cannot draw is in that count too — it is selected, and it is not going to change size here.
  const resizable = selected.some((object) => isResizableType(object.type));
  // What there is to pull: all eight, or the two that a thing sized by its content has. Decided by the
  // types in the selection and not by how many of them there are — twenty text objects are still twenty
  // things with no use for a handle above them.
  const handles = handlesForObjects(selected) === 'horizontal' ? SIDE_HANDLES : CORNERS_AND_EDGES;
  const style: React.CSSProperties = {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  } as React.CSSProperties;

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      data-resizable={resizable ? 'true' : 'false'}
      data-handles={handles === SIDE_HANDLES ? 'horizontal' : 'all'}
      data-x={world.x}
      data-y={world.y}
      data-width={world.width}
      data-height={world.height}
      style={style}
    >
      {resizable
        ? handles.map((handle) => (
            <button
              aria-label={`Resize ${HANDLE_LABELS[handle]}`}
              className={`selection-handle selection-handle-${handle}`}
              data-handle={handle}
              data-testid={`resize-${handle}`}
              key={handle}
              style={handleStyle(box, handle)}
              tabIndex={-1}
              type="button"
              onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                // The pointer is the gesture's from here: no focus, no caret, no text selection.
                event.preventDefault();
                event.stopPropagation();
                onHandlePointerDown(event.nativeEvent, handle);
              }}
            />
          ))
        : null}
    </div>
  );
}
