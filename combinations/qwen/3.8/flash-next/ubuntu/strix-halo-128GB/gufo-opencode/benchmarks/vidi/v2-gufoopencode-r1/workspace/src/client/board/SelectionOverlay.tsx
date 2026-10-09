import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLES, unionRects, type Handle } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { SELECTION_OUTLINE_COLOR } from '../objects/stickyStyles';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

const POSITION_LABEL: Record<Handle, string> = {
  n: 'north',
  ne: 'north-east',
  e: 'east',
  se: 'south-east',
  s: 'south',
  sw: 'south-west',
  w: 'west',
  nw: 'north-west'
};

// Handle anchors as fractions of the bounding box (x, y in 0..1).
const HANDLE_ANCHOR: Record<Handle, { fx: number; fy: number }> = {
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 },
  nw: { fx: 0, fy: 0 }
};

const CURSOR: Record<Handle, string> = {
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
  nw: 'nwse-resize'
};

// Screen-space bounding box plus 8 resize handles around the selection.
// Handles are hidden when no selected type is resizable. The box itself never
// intercepts pointer events.
export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const selected = props.snapshot.filter((obj) => props.ids.has(obj.id));
  const box = unionRects(selected.map(objectBounds));
  if (box === null) return null;
  const anyResizable = selected.some((obj) => getObjectType(obj.type)?.resizable === true);
  const topLeft = worldToScreen(props.camera, { x: box.x, y: box.y });
  const width = box.width * props.camera.zoom;
  const height = box.height * props.camera.zoom;
  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40 }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        data-testid="selection-box"
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          width,
          height,
          border: `1px solid ${SELECTION_OUTLINE_COLOR}`,
          boxSizing: 'border-box'
        }}
      />
      {anyResizable &&
        HANDLES.map((handle) => {
          const anchor = HANDLE_ANCHOR[handle];
          return (
            <button
              key={handle}
              type="button"
              aria-label={`Resize ${POSITION_LABEL[handle]}`}
              title={`Resize ${POSITION_LABEL[handle]}`}
              data-testid={`resize-handle-${handle}`}
              style={{
                position: 'absolute',
                left: topLeft.x + width * anchor.fx - HANDLE_SIZE_PX / 2,
                top: topLeft.y + height * anchor.fy - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                padding: 0,
                background: '#ffffff',
                border: `1.5px solid ${SELECTION_OUTLINE_COLOR}`,
                borderRadius: 2,
                cursor: CURSOR[handle],
                pointerEvents: 'auto'
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                props.onHandlePointerDown(event, handle);
              }}
            />
          );
        })}
    </div>
  );
}
