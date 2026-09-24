import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HALF = 2;

export const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

/** Handle centre as a fraction of the box's width and height. */
const HANDLE_POSITION: Record<Handle, readonly [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** The selected objects (in snapshot order) that are still on the board. */
export function selectedObjects(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): ObjectSnapshot[] {
  return snapshot.filter((o) => ids.has(o.id));
}

/** The selection's bounding box in screen px relative to the board area, or null. */
export function selectionScreenBox(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
  camera: Camera,
): Rect | null {
  const box = unionRects(selectedObjects(ids, snapshot).map(objectBounds));
  if (!box) return null;
  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  return { x: topLeft.x, y: topLeft.y, width: box.width * camera.zoom, height: box.height * camera.zoom };
}

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, h: Handle): void;
  /** Hide the handles (board cannot be edited, or text is being edited). */
  hideHandles?: boolean;
}

/**
 * Screen-space bounding box around the selection with 8 resize handles of HANDLE_SIZE_PX at
 * every zoom. Handles are hidden when no selected type is resizable. The box itself never
 * takes pointer events, so objects under it stay clickable.
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown, hideHandles = false }: SelectionOverlayProps) {
  const box = selectionScreenBox(ids, snapshot, camera);
  if (!box) return null;
  const resizable = selectedObjects(ids, snapshot).some((o) => getObjectType(o.type)?.resizable);
  const style: CSSProperties = { left: box.x, top: box.y, width: box.width, height: box.height };
  return (
    <div className="selection-overlay" data-testid="selection-box" style={style}>
      {resizable &&
        !hideHandles &&
        HANDLES.map((h) => {
          const [fx, fy] = HANDLE_POSITION[h];
          const handleStyle: CSSProperties = {
            left: fx * box.width - HANDLE_SIZE_PX / HALF,
            top: fy * box.height - HANDLE_SIZE_PX / HALF,
            width: HANDLE_SIZE_PX,
            height: HANDLE_SIZE_PX,
          };
          return (
            <div
              key={h}
              role="button"
              aria-label={HANDLE_LABELS[h]}
              data-handle={h}
              className={`selection-handle selection-handle--${h}`}
              style={handleStyle}
              onPointerDown={(e) => {
                // Neither the board (pan / marquee) nor the objects below may see this press.
                e.stopPropagation();
                onHandlePointerDown(e, h);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          );
        })}
    </div>
  );
}
