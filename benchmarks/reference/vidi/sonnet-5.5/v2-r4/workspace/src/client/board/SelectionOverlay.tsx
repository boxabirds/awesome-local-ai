import type { PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HANDLES: { handle: Handle; label: string; fx: number; fy: number; cursor: string }[] = [
  { handle: 'nw', label: 'top-left', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { handle: 'n', label: 'top', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { handle: 'ne', label: 'top-right', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { handle: 'e', label: 'right', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { handle: 'se', label: 'bottom-right', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { handle: 's', label: 'bottom', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { handle: 'sw', label: 'bottom-left', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { handle: 'w', label: 'left', fx: 0, fy: 0.5, cursor: 'nesw-resize' },
];

const BOX_COLOR = '#1e88e5';

/** Screen-space rectangle of the selection's bounding box, or null when nothing selected is on the board. */
export function selectionScreenBox(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[], camera: Camera) {
  const world = unionRects(snapshot.filter((o) => ids.has(o.id)).map(objectBounds));
  if (!world) return null;
  const tl = worldToScreen(camera, world);
  return { world, x: tl.x, y: tl.y, width: world.width * camera.zoom, height: world.height * camera.zoom };
}

/** One bounding box around the selection with 8 handles that stay HANDLE_SIZE_PX on screen at any zoom. */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  /** False while the board is not loaded: the box is shown but cannot be resized. */
  editable?: boolean;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, h: Handle): void;
}) {
  const { ids, snapshot, camera } = props;
  const box = selectionScreenBox(ids, snapshot, camera);
  if (!box) return null;
  const resizable = props.editable !== false && snapshot.some((o) => ids.has(o.id) && getObjectType(o.type)?.resizable);

  return (
    <div
      data-testid="selection-box"
      style={{
        position: 'fixed',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        border: `1px solid ${BOX_COLOR}`,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {resizable &&
        HANDLES.map((h) => (
          <div
            key={h.handle}
            role="button"
            aria-label={`Resize ${h.label}`}
            data-handle={h.handle}
            onPointerDown={(e) => {
              e.stopPropagation();
              props.onHandlePointerDown(e, h.handle);
            }}
            style={{
              position: 'absolute',
              left: `calc(${h.fx * 100}% - ${HANDLE_SIZE_PX / 2}px)`,
              top: `calc(${h.fy * 100}% - ${HANDLE_SIZE_PX / 2}px)`,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              boxSizing: 'border-box',
              background: '#fff',
              border: `1px solid ${BOX_COLOR}`,
              cursor: h.cursor,
              pointerEvents: 'auto',
              touchAction: 'none',
            }}
          />
        ))}
    </div>
  );
}
