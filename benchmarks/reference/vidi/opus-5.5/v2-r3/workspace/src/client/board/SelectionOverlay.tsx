import type { PointerEvent } from 'react';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, unionRects, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { isHorizontalOnly } from './useTransformGesture';

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

const HALF = 2;

const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

/** Handle centre as a fraction of the box width/height. */
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

/** The selection's bounding box in world units, or null when nothing is selected. */
export function selectionBounds(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): Rect | null {
  return unionRects(snapshot.filter((o) => ids.has(o.id)).map(objectBounds));
}

/** World rect → screen rect (viewport pixels). */
export function toScreenRect(camera: Camera, r: Rect): Rect {
  const tl = worldToScreen(camera, r);
  return { x: tl.x, y: tl.y, width: r.width * camera.zoom, height: r.height * camera.zoom };
}

/**
 * Bounding box around the selection with 8 resize handles (only left and
 * right when every selected type is horizontal), drawn in screen
 * space so handles keep HANDLE_SIZE_PX at every zoom. Handles are hidden when
 * no selected type is resizable, or when `showHandles` is false.
 */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent<Element>, h: Handle): void;
  showHandles?: boolean;
}) {
  const selected = props.snapshot.filter((o) => props.ids.has(o.id));
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const s = toScreenRect(props.camera, box);
  const resizable = selected.some((o) => getObjectType(o.type)?.resizable);
  const showHandles = (props.showHandles ?? true) && resizable;
  // Text (story 9) has only side handles: its height always follows the content.
  const handles = isHorizontalOnly(selected) ? HORIZONTAL_HANDLES : HANDLES;
  return (
    <div
      className="selection-box"
      data-testid="selection-box"
      style={{ left: s.x, top: s.y, width: s.width, height: s.height }}
    >
      {showHandles &&
        handles.map((h) => (
          <div
            key={h}
            className={`selection-handle handle-${h}`}
            role="button"
            aria-label={HANDLE_LABELS[h]}
            data-handle={h}
            style={{
              left: HANDLE_POS[h][0] * s.width - HANDLE_SIZE_PX / HALF,
              top: HANDLE_POS[h][1] * s.height - HANDLE_SIZE_PX / HALF,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
            }}
            onPointerDown={(e) => props.onHandlePointerDown(e, h)}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ))}
    </div>
  );
}
