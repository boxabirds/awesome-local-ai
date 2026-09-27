// Bounding box + resize handles for the current selection
// (see spec: sel.resize, sel.ui).
//
// Rendered in screen space (fixed): the union of the selected objects'
// bounds, converted through the camera. Handles are a constant 8px at any
// zoom and carry a stable data-handle + aria-label (e2e: [aria-label=...]).
// Handles are only shown when at least one selected type is resizable.

import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_LABEL: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

const HANDLE_CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  const selected = snapshot.filter((o) => ids.has(o.id) && getObjectType(o.type) !== undefined);
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (box === null) return null;
  const resizable = selected.some((o) => getObjectType(o.type)?.resizable === true);

  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;
  const half = HANDLE_SIZE_PX / 2;
  const positions: Record<Handle, { left: number; top: number }> = {
    nw: { left: -half, top: -half },
    n: { left: width / 2 - half, top: -half },
    ne: { left: width - half, top: -half },
    e: { left: width - half, top: height / 2 - half },
    se: { left: width - half, top: height - half },
    s: { left: width / 2 - half, top: height - half },
    sw: { left: -half, top: height - half },
    w: { left: -half, top: height / 2 - half },
  };

  return (
    <div
      data-testid="selection-overlay"
      className="selection-overlay"
      style={{ position: 'fixed', left: topLeft.x, top: topLeft.y, width, height, pointerEvents: 'none' }}
    >
      {resizable &&
        HANDLES.map((handle) => (
          <div
            key={handle}
            data-testid="resize-handle"
            data-handle={handle}
            role="button"
            aria-label={`Resize ${HANDLE_LABEL[handle]}`}
            className={`selection-handle selection-handle--${handle}`}
            style={{
              position: 'absolute',
              left: positions[handle].left,
              top: positions[handle].top,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              cursor: HANDLE_CURSOR[handle],
              pointerEvents: 'auto',
            }}
            onPointerDown={(e) => onHandlePointerDown(e, handle)}
          />
        ))}
    </div>
  );
}
