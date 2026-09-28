// The selection overlay (story 7, sel.transform): the outlines and the eight
// resize handles that make a selection visible and grabbable.
//
// Everything here is drawn in SCREEN space — the component projects each object
// rect through `worldToScreen` instead of sitting inside the world layer, so the
// outlines are always 1.5 screen pixels and the handles always HANDLE_SIZE_PX
// wide whatever the zoom is (a world-space handle would become invisible when
// zoomed out and huge when zoomed in). It renders nothing for the camera, no
// object and no doc: the selection box is derived from the snapshot the caller
// already has.
//
// Handles only appear when at least one selected object's type is `resizable`
// (a board of unknown future types still shows outlines, never fake handles).
import type React from 'react';
import { worldToScreen, type Camera } from '../canvas/camera.ts';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model.ts';
import { unionRects, type Handle, type Rect } from '../../shared/geometry.ts';
import { HANDLE_SIZE_PX } from '../../shared/config.ts';
import { getObjectType } from '../objects/registry.tsx';

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// The accessible name of each handle ("Resize bottom right"), per the contract.
const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top left',
  n: 'Resize top',
  ne: 'Resize top right',
  e: 'Resize right',
  se: 'Resize bottom right',
  s: 'Resize bottom',
  sw: 'Resize bottom left',
  w: 'Resize left',
};

// The pointer the handle shows: the corners and edges pull the box that way.
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
  onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>, handle: Handle): void;
}

export interface SelectionOverlayResult {
  element: React.JSX.Element | null;
  /** the selection's bounding box in world units, null when nothing is selected */
  box: Rect | null;
}

function handlePoint(box: Rect, handle: Handle): Point2 {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return {
    x: handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : cx,
    y: handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : cy,
  };
}
interface Point2 {
  x: number;
  y: number;
}

// Exported for the selection bar, which positions itself on the same box.
export function selectionBox(selected: readonly ObjectSnapshot[]): Rect | null {
  if (selected.length === 0) return null;
  return unionRects(selected.map(objectBounds));
}

export function SelectionOverlay(props: SelectionOverlayProps): React.JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;
  const selected = snapshot.filter((obj) => ids.has(obj.id));
  if (selected.length === 0) return null;
  const box = selectionBox(selected);
  if (box === null) return null;

  let anyResizable = false;
  let allHorizontal = true;
  for (const obj of selected) {
    const spec = getObjectType(obj.type);
    if (spec && spec.resizable) anyResizable = true;
    // A type whose box height is computed (story 9's text) is resized only
    // sideways; the full eight handles return as soon as ANY selected object
    // wants them (a text next to a sticky drags as a group again).
    if (!spec || !spec.resizable || spec.handles !== 'horizontal') allHorizontal = false;
  }
  const shownHandles: readonly Handle[] = allHorizontal
    ? HANDLES.filter((h) => h === 'e' || h === 'w')
    : HANDLES;

  const origin = worldToScreen(camera, { x: box.x, y: box.y });
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div className="selection-overlay" data-selection-count={selected.length}>
      {selected.map((obj) => {
        const corner = worldToScreen(camera, obj);
        return (
          <div
            key={`outline-${obj.id}`}
            data-selected={true}
            data-object-id={obj.id}
            aria-hidden={true}
            className="selection-outline"
            style={{
              left: `${corner.x}px`,
              top: `${corner.y}px`,
              width: `${objectBounds(obj).width * camera.zoom}px`,
              height: `${objectBounds(obj).height * camera.zoom}px`,
            }}
          />
        );
      })}
      <div
        className="selection-box"
        data-testid="selection-box"
        aria-hidden={true}
        style={{
          left: `${origin.x}px`,
          top: `${origin.y}px`,
          width: `${box.width * camera.zoom}px`,
          height: `${box.height * camera.zoom}px`,
        }}
      />
      {anyResizable &&
        shownHandles.map((handle) => {
          const point = handlePoint(box, handle);
          const screen = worldToScreen(camera, point);
          return (
            <div
              key={handle}
              role="button"
              tabIndex={0}
              aria-label={HANDLE_LABELS[handle]}
              data-handle={handle}
              className={`selection-handle selection-handle--${handle}`}
              style={{
                left: `${screen.x - half}px`,
                top: `${screen.y - half}px`,
                width: `${HANDLE_SIZE_PX}px`,
                height: `${HANDLE_SIZE_PX}px`,
                cursor: HANDLE_CURSORS[handle],
              }}
              onPointerDown={(e) => {
                // The handles sit above the objects: the event must not reach the
                // object underneath, which would start a move instead of a resize.
                e.stopPropagation();
                e.preventDefault();
                onHandlePointerDown(e, handle);
              }}
            />
          );
        })}
    </div>
  );
}
