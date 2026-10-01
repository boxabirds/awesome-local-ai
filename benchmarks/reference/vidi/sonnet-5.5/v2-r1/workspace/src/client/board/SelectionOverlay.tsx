import type { PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects } from '../../shared/geometry';
import type { Handle, Rect } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
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

/** Screen-space rect of a world rect. */
export function screenRect(camera: Camera, r: Rect): Rect {
  const p = worldToScreen(camera, r);
  return { x: p.x, y: p.y, width: r.width * camera.zoom, height: r.height * camera.zoom };
}

/** Selection outlines, the bounding box and its 8 handles, drawn in screen space so handles keep their size. */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
}) {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const b = screenRect(props.camera, box);
  const resizable = selected.some((o) => getObjectType(o.type)?.resizable);
  const horizontalOnly = selected.every((o) => getObjectType(o.type)?.handles === 'horizontal');
  const handles = horizontalOnly ? HANDLES.filter((h) => h.handle === 'e' || h.handle === 'w') : HANDLES;
  return (
    <div className="selection-overlay" data-testid="selection-overlay">
      {selected.map((o) => {
        const r = screenRect(props.camera, objectBounds(o));
        return (
          <div
            key={o.id}
            className="selection-outline"
            data-testid="selection-outline"
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          />
        );
      })}
      <div
        className="selection-box"
        data-testid="selection-box"
        style={{ left: b.x, top: b.y, width: b.width, height: b.height }}
      >
        {resizable &&
          handles.map((h) => (
            <button
              key={h.handle}
              type="button"
              tabIndex={-1}
              className="selection-handle"
              aria-label={`Resize ${h.label}`}
              data-handle={h.handle}
              style={{
                left: h.fx * b.width - HANDLE_SIZE_PX / HALF,
                top: h.fy * b.height - HANDLE_SIZE_PX / HALF,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                cursor: h.cursor,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onHandlePointerDown(e, h.handle);
              }}
            />
          ))}
      </div>
    </div>
  );
}
