import type { PointerEvent as ReactPointerEvent } from 'react';
import { type ObjectSnapshot, objectBounds } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { HANDLES, type Handle, type Rect, unionRects } from '../../shared/geometry';
import { type Camera, worldToScreen } from '../canvas/camera';
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

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

const HORIZONTAL_HANDLES: readonly Handle[] = ['e', 'w'];

/** Handles for a selection: only left and right when every selected type has horizontal handles (text). */
export function handlesFor(selected: readonly ObjectSnapshot[]): readonly Handle[] {
  const horizontal = selected.length > 0 && selected.every((o) => getObjectType(o.type)?.handles === 'horizontal');
  return horizontal ? HORIZONTAL_HANDLES : HANDLES;
}

function toScreen(camera: Camera, r: Rect): Rect {
  const tl = worldToScreen(camera, { x: r.x, y: r.y });
  return { x: tl.x, y: tl.y, width: r.width * camera.zoom, height: r.height * camera.zoom };
}

function handleCentre(box: Rect, h: Handle): { x: number; y: number } {
  const x = h.includes('w') ? box.x : h.includes('e') ? box.x + box.width : box.x + box.width / 2;
  const y = h.includes('n') ? box.y : h.includes('s') ? box.y + box.height : box.y + box.height / 2;
  return { x, y };
}

/**
 * Screen-space selection chrome (same for every object type): an outline per
 * selected object, one bounding box, and 8 resize handles of HANDLE_SIZE_PX
 * (only left and right when every selected type is horizontal-only, e.g. text).
 * Handles are hidden when no selected type can be resized (or `showHandles` is false).
 */
export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, h: Handle): void;
  showHandles?: boolean;
}): React.JSX.Element | null {
  const { camera } = props;
  const selected = props.snapshot.filter((o) => props.ids.has(o.id) && getObjectType(o.type));
  const worldBox = unionRects(selected.map(objectBounds));
  if (!worldBox) return null;
  const box = toScreen(camera, worldBox);
  const resizable = selected.some((o) => getObjectType(o.type)?.resizable);
  const showHandles = (props.showHandles ?? true) && resizable;
  const onlyArrows = selected.every((o) => o.type === 'connector');
  return (
    <div className="selection-overlay" data-testid="selection-overlay" aria-hidden={showHandles ? undefined : true}>
      {selected.map((o) => {
        // An arrow shows its own selection (highlighted line and end handles).
        if (o.type === 'connector') return null;
        const r = toScreen(camera, objectBounds(o));
        return (
          <div
            key={o.id}
            className="selection-outline"
            data-outline-for={o.id}
            style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
          />
        );
      })}
      {!onlyArrows && (
        <div
          className="selection-box"
          data-testid="selection-box"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
      {showHandles &&
        handlesFor(selected).map((h) => {
          const c = handleCentre(box, h);
          return (
            <div
              key={h}
              className="selection-handle"
              role="button"
              aria-label={`Resize ${HANDLE_NAMES[h]}`}
              data-handle={h}
              style={{
                left: c.x - HANDLE_SIZE_PX / 2,
                top: c.y - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                cursor: CURSORS[h],
              }}
              onPointerDown={(e) => props.onHandlePointerDown(e, h)}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          );
        })}
    </div>
  );
}
