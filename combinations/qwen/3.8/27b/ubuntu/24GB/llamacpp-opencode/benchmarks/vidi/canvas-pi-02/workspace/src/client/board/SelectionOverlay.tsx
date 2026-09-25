import type { JSX } from 'react';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

/**
 * Screen-space selection chrome (story 7, sel.transform): the blue bounding
 * box of the current selection and its 8 resize handles (4 corners, 4
 * edges). Handles are a constant HANDLE_SIZE_PX on screen at any zoom and
 * carry accessible names ("Resize top-left", …).
 *
 * Handles are rendered only when at least one selected type is resizable
 * (the registry declares it per type); they are hit targets for the
 * transform gesture's handle drags.
 */
const HANDLES: Array<{ handle: Handle; name: string; cursor: string; at: (w: number, h: number) => { x: number; y: number } }> = [
  { handle: 'nw', name: 'top-left', cursor: 'nwse-resize', at: (w, h) => ({ x: 0, y: 0 }) },
  { handle: 'n', name: 'top', cursor: 'ns-resize', at: (w, h) => ({ x: w / 2, y: 0 }) },
  { handle: 'ne', name: 'top-right', cursor: 'nesw-resize', at: (w, h) => ({ x: w, y: 0 }) },
  { handle: 'e', name: 'right', cursor: 'ew-resize', at: (w, h) => ({ x: w, y: h / 2 }) },
  { handle: 'se', name: 'bottom-right', cursor: 'nwse-resize', at: (w, h) => ({ x: w, y: h }) },
  { handle: 's', name: 'bottom', cursor: 'ns-resize', at: (w, h) => ({ x: w / 2, y: h }) },
  { handle: 'sw', name: 'bottom-left', cursor: 'nesw-resize', at: (w, h) => ({ x: 0, y: h }) },
  { handle: 'w', name: 'left', cursor: 'ew-resize', at: (w, h) => ({ x: 0, y: h / 2 }) },
];

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: PointerEvent, handle: Handle) => void;
}

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  const box = unionRects(selected.map(objectBounds));
  if (box === null) return null;

  const resizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const w = box.width * camera.zoom;
  const h = box.height * camera.zoom;
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div className="vidi6-selection-overlay" aria-hidden={resizable ? undefined : true}>
      <div
        className="vidi6-selection-box"
        data-testid="selection-box"
        style={{ left: topLeft.x, top: topLeft.y, width: w, height: h }}
      />
      {resizable &&
        HANDLES.map(({ handle, name, cursor, at }) => {
          const p = at(w, h);
          return (
            <div
              key={handle}
              role="button"
              tabIndex={-1}
              aria-label={`Resize ${name}`}
              className="vidi6-handle"
              data-testid={`handle-${handle}`}
              data-handle={handle}
              style={{
                left: topLeft.x + p.x - half,
                top: topLeft.y + p.y - half,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                cursor,
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                onHandlePointerDown(e.nativeEvent, handle);
              }}
              onPointerUp={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          );
        })}
    </div>
  );
}
