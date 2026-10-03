import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects, handleLabel, HANDLES, type Handle } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

const OUTLINE_COLOR = '#1A73E8';

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

/**
 * Screen-space overlay for the current selection (story 7): a blue bounding
 * box around every selected object and 8 resize handles (4 corners, 4 edges)
 * of HANDLE_SIZE_PX, constant on screen at any zoom, each with an accessible
 * name ("Resize top-left", …). Handles are hidden when no selected type is
 * resizable. The overlay never intercepts clicks except on the handles.
 */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, h: Handle): void;
}): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;

  const resizable = selected.some((o) => getObjectType(o.type)?.resizable);
  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const w = box.width * camera.zoom;
  const h = box.height * camera.zoom;

  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 5, overflow: 'hidden' }}
    >
      <div
        data-testid="selection-box"
        style={{
          position: 'absolute',
          left: topLeft.x,
          top: topLeft.y,
          width: w,
          height: h,
          border: `1px solid ${OUTLINE_COLOR}`,
          boxSizing: 'border-box',
        }}
      />
      {resizable &&
        HANDLES.map((handle) => {
          const cx =
            handle.includes('w') ? topLeft.x : handle.includes('e') ? topLeft.x + w : topLeft.x + w / 2;
          const cy =
            handle.includes('n') ? topLeft.y : handle.includes('s') ? topLeft.y + h : topLeft.y + h / 2;
          return (
            <div
              key={handle}
              data-testid={`resize-handle-${handle}`}
              role="button"
              aria-label={handleLabel(handle)}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
              style={{
                position: 'absolute',
                left: cx - HANDLE_SIZE_PX / 2,
                top: cy - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                background: '#fff',
                border: `1px solid ${OUTLINE_COLOR}`,
                borderRadius: 1,
                boxSizing: 'border-box',
                pointerEvents: 'auto',
                cursor: HANDLE_CURSORS[handle],
              }}
            />
          );
        })}
    </div>
  );
}
