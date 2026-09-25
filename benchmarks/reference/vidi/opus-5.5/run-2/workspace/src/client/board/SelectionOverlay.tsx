/**
 * Selection outlines, bounding box and 8 resize handles (only left and right when every
 * selected type has `handles: 'horizontal'`, story 9), drawn in screen space so outlines
 * and handles (HANDLE_SIZE_PX) keep their size at every zoom (anchor: sel.transform).
 * Only the handles take pointer input; everything else lets presses reach the board and
 * the objects underneath.
 */
import type { CSSProperties, PointerEvent } from 'react';
import { worldToScreen, type Camera } from '../canvas/camera';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, unionRects, type Handle, type Rect } from '../../shared/geometry';
import { getObjectType } from '../objects/registry';

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

/** Handle centre as a fraction of the box (0 = left/top, 1 = right/bottom). */
const HANDLE_POSITION: Record<Handle, [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

const PERCENT = 100;

const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

/** Selected objects of known types, in snapshot order. */
export function selectedObjects(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): ObjectSnapshot[] {
  return ids.size === 0 ? [] : snapshot.filter((o) => ids.has(o.id) && getObjectType(o.type) !== undefined);
}

/** Bounding box of the selection in world units, or null when nothing is selected. */
export function selectionBounds(ids: ReadonlySet<string>, snapshot: readonly ObjectSnapshot[]): Rect | null {
  return unionRects(selectedObjects(ids, snapshot).map(objectBounds));
}

export function toScreenRect(camera: Camera, r: Rect): Rect {
  const p = worldToScreen(camera, r);
  return { x: p.x, y: p.y, width: r.width * camera.zoom, height: r.height * camera.zoom };
}

function rectStyle(r: Rect): CSSProperties {
  return { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` };
}

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent<HTMLElement>, h: Handle): void;
  /** False hides the handles (board read-only, editing text, or nothing resizable). */
  showHandles?: boolean;
}

export function SelectionOverlay(props: SelectionOverlayProps): React.JSX.Element | null {
  const { camera } = props;
  const objs = selectedObjects(props.ids, props.snapshot);
  const box = unionRects(objs.map(objectBounds));
  if (box === null) return null;
  const resizable = objs.some((o) => getObjectType(o.type)?.resizable === true);
  const showHandles = (props.showHandles ?? true) && resizable;
  // Types whose height follows their content (story 9 text) get only the side handles.
  const horizontalOnly = objs.every((o) => getObjectType(o.type)?.handles === 'horizontal');
  const handles = horizontalOnly ? HORIZONTAL_HANDLES : HANDLES;
  const screenBox = toScreenRect(camera, box);
  return (
    <div className="selection-overlay" data-testid="selection-overlay">
      {objs.map((o) => (
        <div
          key={o.id}
          className="selection-outline"
          data-testid="selection-outline"
          data-object-id={o.id}
          style={rectStyle(toScreenRect(camera, objectBounds(o)))}
        />
      ))}
      <div className="selection-box" data-testid="selection-box" style={rectStyle(screenBox)}>
        {showHandles &&
          handles.map((h) => {
            const [fx, fy] = HANDLE_POSITION[h];
            return (
              <div
                key={h}
                role="button"
                aria-label={HANDLE_LABELS[h]}
                title={HANDLE_LABELS[h]}
                className={`selection-handle selection-handle-${h}`}
                data-handle={h}
                style={{
                  left: `${fx * PERCENT}%`,
                  top: `${fy * PERCENT}%`,
                  width: `${HANDLE_SIZE_PX}px`,
                  height: `${HANDLE_SIZE_PX}px`,
                }}
                onPointerDown={(e) => props.onHandlePointerDown(e, h)}
                onDoubleClick={(e) => e.stopPropagation()}
              />
            );
          })}
      </div>
    </div>
  );
}
