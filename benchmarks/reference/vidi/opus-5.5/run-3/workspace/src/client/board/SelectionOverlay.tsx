import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, unionRects, type Handle } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

export const HANDLE_NAMES: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** Handle centre as a fraction of the box (0 = left/top, 1 = right/bottom). */
const HANDLE_POS: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** The selection's bounding box in world units, or null when nothing selected is on the board. */
export function selectionBounds(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]) {
  return unionRects(snapshot.filter((o) => ids.has(o.id)).map(objectBounds));
}

/**
 * Bounding box around the whole selection with 8 resize handles, drawn in screen space so the handles keep
 * HANDLE_SIZE_PX at every zoom. Handles are hidden when no selected type is resizable, or `resizable` is false
 * (board not editable). Each selected object draws its own outline (`data-selected`).
 */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent, h: Handle): void;
  resizable?: boolean;
}) {
  const { ids, snapshot, camera } = props;
  if (ids.size === 0) return null;
  const box = selectionBounds(ids, snapshot);
  if (!box) return null;
  const topLeft = worldToScreen(camera, box);
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;
  const showHandles =
    props.resizable !== false && snapshot.some((o) => ids.has(o.id) && getObjectType(o.type)?.resizable);
  return (
    <div
      className="selection-box"
      data-testid="selection-box"
      style={{ left: topLeft.x, top: topLeft.y, width, height }}
    >
      {showHandles &&
        HANDLES.map((h) => {
          const [fx, fy] = HANDLE_POS[h];
          const style: CSSProperties = {
            left: fx * width - HANDLE_SIZE_PX / 2,
            top: fy * height - HANDLE_SIZE_PX / 2,
            width: HANDLE_SIZE_PX,
            height: HANDLE_SIZE_PX,
          };
          return (
            <div
              key={h}
              role="button"
              tabIndex={-1}
              aria-label={`Resize ${HANDLE_NAMES[h]}`}
              className={`selection-handle selection-handle--${h}`}
              data-handle={h}
              style={style}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.onHandlePointerDown(e, h);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          );
        })}
    </div>
  );
}
