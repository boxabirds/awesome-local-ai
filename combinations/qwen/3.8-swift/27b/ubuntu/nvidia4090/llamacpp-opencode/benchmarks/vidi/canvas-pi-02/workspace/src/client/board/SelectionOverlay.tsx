// Selection bounding box + 8 resize handles (story 7, sel.transform,
// sel.ui). Rendered in SCREEN space (fixed positioning) so the handles stay
// HANDLE_SIZE_PX at any zoom. Per-object outlines live on the objects
// themselves (data-selected); the box frames the whole selection.
//
// Handles appear only when the selection contains a resizable object type;
// each is a real <button> with an accessible name ("Resize top-left" …) so
// it is focusable, has a cursor and is announced by screen readers.

import type { ReactElement } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import {
  HANDLE_NAMES,
  HANDLES,
  unionRects,
  type Handle,
} from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}

function handleOffset(handle: Handle, w: number, h: number): { x: number; y: number } {
  switch (handle) {
    case 'nw':
      return { x: 0, y: 0 };
    case 'n':
      return { x: w / 2, y: 0 };
    case 'ne':
      return { x: w, y: 0 };
    case 'e':
      return { x: w, y: h / 2 };
    case 'se':
      return { x: w, y: h };
    case 's':
      return { x: w / 2, y: h };
    case 'sw':
      return { x: 0, y: h };
    case 'w':
      return { x: 0, y: h / 2 };
  }
}

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

export function SelectionOverlay(props: SelectionOverlayProps): ReactElement | null {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (box === null) return null;

  const resizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  const origin = worldToScreen(props.camera, { x: box.x, y: box.y });
  const w = box.width * props.camera.zoom;
  const h = box.height * props.camera.zoom;

  return (
    <div
      className="selection-overlay"
      data-testid="selection-box"
      aria-hidden={resizable ? undefined : true}
      style={{
        position: 'fixed',
        left: origin.x,
        top: origin.y,
        width: w,
        height: h,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {resizable &&
        HANDLES.map((handle) => {
          const pos = handleOffset(handle, w, h);
          return (
            <button
              key={handle}
              type="button"
              className={`selection-handle selection-handle--${handle}`}
              aria-label={`Resize ${HANDLE_NAMES[handle]}`}
              title={`Resize ${HANDLE_NAMES[handle]}`}
              style={{
                position: 'absolute',
                left: pos.x - HANDLE_SIZE_PX / 2,
                top: pos.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                pointerEvents: 'auto',
                cursor: CURSORS[handle],
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onHandlePointerDown(e, handle);
              }}
            />
          );
        })}
    </div>
  );
}
