// Selection overlay (story 7): bounding box + resize handles for the
// current selection, rendered in screen space (always 1px border, 8px
// handles) as a sibling of the viewport inside .app-root.

import type { PointerEvent as ReactPointerEvent } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';
import { worldToScreen, type Camera } from '../canvas/camera';

const HANDLES: { handle: Handle; fx: number; fy: number; cursor: string; label: string }[] = [
  { handle: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize', label: 'top-left' },
  { handle: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize', label: 'top' },
  { handle: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize', label: 'top-right' },
  { handle: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize', label: 'right' },
  { handle: 'se', fx: 1, fy: 1, cursor: 'nwse-resize', label: 'bottom-right' },
  { handle: 's', fx: 0.5, fy: 1, cursor: 'ns-resize', label: 'bottom' },
  { handle: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize', label: 'bottom-left' },
  { handle: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize', label: 'left' },
];

export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: ReactPointerEvent<Element>, handle: Handle) => void;
}): React.ReactElement | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  const box: Rect | null = unionRects(selected.map(objectBounds));
  if (box === null) return null;

  const anyResizable = selected.some((o) => getObjectType(o.type)?.resizable);
  // Story 9: a lone text object shows only the horizontal (e/w) handles.
  const horizontalOnly =
    selected.length === 1 && getObjectType(selected[0].type)?.handles === 'horizontal';
  const visibleHandles = horizontalOnly
    ? HANDLES.filter((h) => h.handle === 'e' || h.handle === 'w')
    : HANDLES;
  const tl = worldToScreen(camera, { x: box.x, y: box.y });
  const w = box.width * camera.zoom;
  const h = box.height * camera.zoom;

  return (
    <div
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        left: tl.x,
        top: tl.y,
        width: w,
        height: h,
        border: '1.5px solid #1976D2',
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {anyResizable &&
        visibleHandles.map(({ handle, fx, fy, cursor, label }) => (
          <div
            key={handle}
            role="button"
            aria-label={`Resize ${label}`}
            data-testid={`resize-handle-${handle}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
            style={{
              position: 'absolute',
              left: fx * w - HANDLE_SIZE_PX / 2,
              top: fy * h - HANDLE_SIZE_PX / 2,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              backgroundColor: 'white',
              border: '1px solid #1976D2',
              borderRadius: '2px',
              cursor,
              pointerEvents: 'auto',
            }}
          />
        ))}
    </div>
  );
}
