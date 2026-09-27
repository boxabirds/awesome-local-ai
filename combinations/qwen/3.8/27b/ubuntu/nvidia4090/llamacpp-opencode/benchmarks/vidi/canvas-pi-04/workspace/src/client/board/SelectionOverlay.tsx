// Story 7: the selection outline and resize handles (anchor: sel.transform).
//
// Rendered as a screen-space overlay above the board. The group bounding box is
// converted from world to screen with the camera, and the eight handles are a
// constant HANDLE_SIZE_PX on screen (no counter-scaling needed in screen space).
// Handles are shown only when at least one selected type is resizable, and each
// is labelled "Resize <position>" (the exact text the e2e tests target).

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Point, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

function handleCenter(box: Rect, handle: Handle): Point {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const x = handle.includes('w') ? box.x : handle.includes('e') ? box.x + box.width : cx;
  const y = handle.includes('n') ? box.y : handle.includes('s') ? box.y + box.height : cy;
  return { x, y };
}

function pickSelected(snapshot: readonly ObjectSnapshot[], ids: ReadonlySet<string>): ObjectSnapshot[] {
  const byId = new Map(snapshot.map((o) => [o.id, o]));
  const out: ObjectSnapshot[] = [];
  for (const id of ids) {
    const o = byId.get(id);
    if (o !== undefined) out.push(o);
  }
  return out;
}

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: ReactPointerEvent, handle: Handle) => void;
}

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;
  const selected = pickSelected(snapshot, ids);
  if (selected.length === 0) return null;
  const box = unionRects(selected.map((o) => objectBounds(o)));
  if (box === null) return null;
  const anyResizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  // Story 9: when EVERY selected object's spec is horizontal-only (text), the
  // group box shows the e/w handles only (text.height: height is derived and
  // must not be handle-adjustable). A mixed selection (text + sticky) keeps
  // the full story 7 handle set.
  const allHorizontal =
    selected.length > 0 &&
    selected.every((o) => (getObjectType(o.type)?.handles ?? 'all') === 'horizontal');
  const shownHandles = anyResizable ? (allHorizontal ? HORIZONTAL_HANDLES : HANDLES) : [];

  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;

  return (
    <div className="selection-overlay">
      <div
        className="selection-box"
        style={{ left: topLeft.x, top: topLeft.y, width, height }}
      />
      {shownHandles.map((h) => {
          const c = worldToScreen(camera, handleCenter(box, h));
          return (
            <div
              key={h}
              className={`selection-handle selection-handle--${h}`}
              role="button"
              aria-label={`Resize ${h}`}
              style={{ left: c.x, top: c.y }}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, h);
              }}
            />
          );
        })}
    </div>
  );
}
