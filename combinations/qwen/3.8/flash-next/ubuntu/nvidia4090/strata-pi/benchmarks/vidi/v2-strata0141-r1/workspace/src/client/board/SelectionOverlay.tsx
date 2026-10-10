import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, HANDLES, type Handle, type Rect } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { worldToScreen, type Camera } from '../canvas/camera';
import type { PointerEventLike } from '../objects/registry';

/**
 * The bounding box and the eight resize handles of a selection
 * (anchor `sel.transform`).
 *
 * It is drawn in screen space over the world layer, so handles stay
 * HANDLE_SIZE_PX on screen at every zoom. The box is the union of the selected
 * objects' bounds as the document holds them, which is why the handles follow a
 * resize as it happens instead of lagging behind the pointer.
 */
export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  /** False when no selected object's type is resizable: handles are hidden. */
  resizable: boolean;
  onHandlePointerDown(event: PointerEventLike, handle: Handle): void;
}

const HANDLE_NAME: Record<Handle, string> = {
  nw: 'top-left corner',
  n: 'top edge',
  ne: 'top-right corner',
  e: 'right edge',
  se: 'bottom-right corner',
  s: 'bottom edge',
  sw: 'bottom-left corner',
  w: 'left edge',
};

/** Where a handle sits on the box, in world units. */
function handleAnchor(box: Rect, handle: Handle): { x: number; y: number } {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  switch (handle) {
    case 'nw':
      return { x: left, y: top };
    case 'n':
      return { x: midX, y: top };
    case 'ne':
      return { x: right, y: top };
    case 'e':
      return { x: right, y: midY };
    case 'se':
      return { x: right, y: bottom };
    case 's':
      return { x: midX, y: bottom };
    case 'sw':
      return { x: left, y: bottom };
    case 'w':
      return { x: left, y: midY };
  }
}

export function SelectionOverlay(props: SelectionOverlayProps) {
  const { ids, snapshot, camera, resizable, onHandlePointerDown } = props;

  const selected = snapshot.filter((obj) => ids.has(obj.id));
  if (selected.length === 0) {
    return null;
  }
  const box = unionRects(selected.map(objectBounds));
  if (!box) {
    return null;
  }
  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const bottomRight = worldToScreen(camera, { x: box.x + box.width, y: box.y + box.height });
  const width = Math.abs(bottomRight.x - topLeft.x);
  const height = Math.abs(bottomRight.y - topLeft.y);
  const left = Math.min(topLeft.x, bottomRight.x);
  const top = Math.min(topLeft.y, bottomRight.y);

  return (
    <div className="selection-overlay" data-testid="selection-overlay" data-resizable={resizable ? 'true' : 'false'}>
      <div
        className="selection-overlay__box"
        data-testid="selection-box"
        aria-hidden="true"
        style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}
      />
      {resizable
        ? HANDLES.map((handle) => {
            const anchor = worldToScreen(camera, handleAnchor(box, handle));
            return (
              <button
                key={handle}
                type="button"
                className={`selection-overlay__handle selection-overlay__handle--${handle}`}
                data-testid={`resize-handle-${handle}`}
                data-handle={handle}
                aria-label={`Resize ${HANDLE_NAME[handle]}`}
                style={{
                  left: `${anchor.x - HANDLE_SIZE_PX / 2}px`,
                  top: `${anchor.y - HANDLE_SIZE_PX / 2}px`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onHandlePointerDown(event, handle);
                }}
              />
            );
          })
        : null}
    </div>
  );
}
