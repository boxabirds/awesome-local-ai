import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HALF = 2;

export const HANDLES: { handle: Handle; label: string; fx: number; fy: number; cursor: string }[] = [
  { handle: 'nw', label: 'top-left', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { handle: 'n', label: 'top', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { handle: 'ne', label: 'top-right', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { handle: 'e', label: 'right', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { handle: 'se', label: 'bottom-right', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { handle: 's', label: 'bottom', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { handle: 'sw', label: 'bottom-left', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { handle: 'w', label: 'left', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

/** The selection's bounding box in screen pixels, or null when nothing selected exists. */
export function selectionScreenBox(
  ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[], camera: Camera,
): Rect | null {
  const world = unionRects(snapshot.filter((o) => ids.has(o.id)).map(objectBounds));
  if (!world) return null;
  const p = worldToScreen(camera, world);
  return { x: p.x, y: p.y, width: world.width * camera.zoom, height: world.height * camera.zoom };
}

export function SelectionOverlay(props: {
  ids: ReadonlySet<string>; snapshot: readonly ObjectSnapshot[]; camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
  /** Hides the handles (read-only board); the outline stays. */
  readOnly?: boolean;
}) {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  const box = selectionScreenBox(ids, snapshot, camera);
  if (!box) return null;
  const selected = snapshot.filter((o) => ids.has(o.id));
  const resizable = !props.readOnly && selected.some((o) => getObjectType(o.type)?.resizable);
  const horizontalOnly = selected.every((o) => getObjectType(o.type)?.handles === 'horizontal');
  const handles = horizontalOnly ? HANDLES.filter((h) => h.handle === 'e' || h.handle === 'w') : HANDLES;
  const style: CSSProperties = { left: box.x, top: box.y, width: box.width, height: box.height };
  return (
    <div className="selection-box" data-testid="selection-box" style={style}>
      {resizable && handles.map((h) => (
        <button
          key={h.handle}
          type="button"
          className="selection-handle"
          aria-label={`Resize ${h.label}`}
          data-handle={h.handle}
          tabIndex={-1}
          style={{
            left: box.width * h.fx - HANDLE_SIZE_PX / HALF,
            top: box.height * h.fy - HANDLE_SIZE_PX / HALF,
            width: HANDLE_SIZE_PX,
            height: HANDLE_SIZE_PX,
            cursor: h.cursor,
          }}
          onPointerDown={(e) => onHandlePointerDown(e, h.handle)}
        />
      ))}
    </div>
  );
}
