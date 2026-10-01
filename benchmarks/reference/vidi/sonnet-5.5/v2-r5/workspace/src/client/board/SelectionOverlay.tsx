import type { PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HALF = 2;

export const HANDLES: Array<{ handle: Handle; label: string; fx: number; fy: number; cursor: string }> = [
  { handle: 'nw', label: 'top-left', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { handle: 'n', label: 'top', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { handle: 'ne', label: 'top-right', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { handle: 'e', label: 'right', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { handle: 'se', label: 'bottom-right', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { handle: 's', label: 'bottom', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { handle: 'sw', label: 'bottom-left', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { handle: 'w', label: 'left', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

/** Screen-space rectangle (relative to the viewport) around the selected objects, or null when none. */
export function selectionScreenBox(
  ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[], camera: Camera,
): { x: number; y: number; width: number; height: number } | null {
  const world = unionRects(snapshot.filter((o) => ids.has(o.id)).map(objectBounds));
  if (!world) return null;
  const tl = worldToScreen(camera, world);
  return { x: tl.x, y: tl.y, width: world.width * camera.zoom, height: world.height * camera.zoom };
}

/** Bounding box and 8 handles of the selection, drawn in screen space so handles keep their size at any zoom. */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>; snapshot: readonly ObjectSnapshot[]; camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
  /** Handles are not offered while the board cannot be edited. */
  canEdit?: boolean;
}) {
  const { ids, snapshot, camera, canEdit = true } = props;
  const box = selectionScreenBox(ids, snapshot, camera);
  if (!box) return null;
  const resizable = snapshot.some((o) => ids.has(o.id) && getObjectType(o.type)?.resizable);
  return (
    <div className="selection-overlay" data-testid="selection-overlay">
      <div
        className="selection-box"
        data-testid="selection-box"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      />
      {resizable && canEdit && HANDLES.map((h) => (
        <button
          key={h.handle}
          type="button"
          tabIndex={-1}
          className="selection-handle"
          aria-label={`Resize ${h.label}`}
          data-handle={h.handle}
          style={{
            left: box.x + box.width * h.fx - HANDLE_SIZE_PX / HALF,
            top: box.y + box.height * h.fy - HANDLE_SIZE_PX / HALF,
            width: HANDLE_SIZE_PX, height: HANDLE_SIZE_PX, cursor: h.cursor,
          }}
          onPointerDown={(e) => { e.stopPropagation(); props.onHandlePointerDown(e, h.handle); }}
        />
      ))}
    </div>
  );
}
