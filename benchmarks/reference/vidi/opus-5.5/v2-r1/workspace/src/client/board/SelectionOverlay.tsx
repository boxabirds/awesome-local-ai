// Bounding box and resize handles of the selection, in screen space (story 7). Handles are
// HANDLE_SIZE_PX at every zoom.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { type ObjectSnapshot, objectBounds } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, type Handle, unionRects } from '../../shared/geometry';
import { type Camera, worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

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

/** Selected objects of a registered type, in stacking order. */
export function selectedObjects(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): ObjectSnapshot[] {
  return snapshot.filter((o) => ids.has(o.id) && getObjectType(o.type) !== undefined);
}

/** The selection's bounding box in screen px relative to the board, or null when nothing is selected. */
export function selectionScreenBox(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
  camera: Camera,
) {
  const box = unionRects(selectedObjects(ids, snapshot).map(objectBounds));
  if (!box) return null;
  const topLeft = worldToScreen(camera, box);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: box.width * camera.zoom,
    height: box.height * camera.zoom,
  };
}

export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, h: Handle): void;
  /** False hides the handles (board locked, text being edited). */
  interactive?: boolean;
}) {
  const box = selectionScreenBox(props.ids, props.snapshot, props.camera);
  if (!box) return null;
  const specs = selectedObjects(props.ids, props.snapshot).map((o) => getObjectType(o.type));
  const resizable = specs.some((spec) => spec?.resizable);
  const showHandles = resizable && (props.interactive ?? true);
  // Only side handles when every selected type's height follows its content (text, story 9).
  const handles = specs.every((spec) => !spec?.resizable || spec.handles === 'horizontal')
    ? HORIZONTAL_HANDLES
    : HANDLES;
  const half = HANDLE_SIZE_PX / 2;
  const at = (h: Handle) => ({
    left: (h.includes('w') ? 0 : h.includes('e') ? box.width : box.width / 2) - half,
    top: (h.includes('n') ? 0 : h.includes('s') ? box.height : box.height / 2) - half,
    width: HANDLE_SIZE_PX,
    height: HANDLE_SIZE_PX,
  });
  return (
    <div
      className="selection-box"
      data-testid="selection-box"
      style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    >
      {showHandles &&
        handles.map((h) => (
          <div
            key={h}
            role="button"
            tabIndex={-1}
            aria-label={`Resize ${HANDLE_NAMES[h]}`}
            className={`selection-handle handle-${h}`}
            data-handle={h}
            style={at(h)}
            onPointerDown={(e) => props.onHandlePointerDown(e, h)}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ))}
    </div>
  );
}
