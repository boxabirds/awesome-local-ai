import type { PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { ObjectSnapshot } from '@/shared/board-model';
import { objectBounds } from '@/shared/board-model';
import { unionRects, type Handle } from '@/shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { HANDLE_SIZE_PX } from '@/shared/config';
import { getObjectType } from '../objects/registry';

/**
 * Selection overlay (story 7): the union bounding box of the current
 * selection plus resize handles. Rendered in screen space (fixed
 * positioning) so the box border and handles keep a constant size at any
 * zoom; per-object outlines stay on the objects themselves (data-selected).
 *
 * Handles are hidden unless at least one selected object's type is
 * resizable. Each handle has aria-label "Resize <position>" (sel.transform).
 * Story 9: when every selected object's spec is `handles: 'horizontal'`
 * (text objects), only the e/w handles show — text height always follows
 * the content (text.fixed_width), and the eight-handle box resize would
 * let users set a height the object does not have.
 */

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const SELECTION_COLOR = '#1A73E8';
const HALF = HANDLE_SIZE_PX / 2;

function handleStyle(handle: Handle): React.CSSProperties {
  // Each handle is centred on its edge/corner of the box.
  const left =
    handle === 'w' || handle === 'nw' || handle === 'sw'
      ? -HALF
      : handle === 'e' || handle === 'ne' || handle === 'se'
        ? 'calc(100% - ' + HALF + 'px)'
        : 'calc(50% - ' + HALF + 'px)';
  const top =
    handle === 'n' || handle === 'nw' || handle === 'ne'
      ? -HALF
      : handle === 's' || handle === 'se' || handle === 'sw'
        ? 'calc(100% - ' + HALF + 'px)'
        : 'calc(50% - ' + HALF + 'px)';
  return {
    position: 'absolute',
    left,
    top,
    width: HANDLE_SIZE_PX,
    height: HANDLE_SIZE_PX,
    background: '#ffffff',
    border: `1px solid ${SELECTION_COLOR}`,
    borderRadius: 2,
    cursor: HANDLE_CURSORS[handle],
    pointerEvents: 'auto',
    boxSizing: 'border-box',
  };
}

export function SelectionOverlay(props: SelectionOverlayProps): ReactElement | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;

  const box = unionRects(selected.map((o) => objectBounds(o)));
  if (!box) return null;

  const resizable = selected.some((o) => getObjectType(o.type)?.resizable);
  // Story 9: horizontal-only handles when the whole selection is horizontal.
  const handlesOnlyHorizontal = selected.every(
    (o) => getObjectType(o.type)?.handles === 'horizontal',
  );
  const handles: readonly Handle[] = resizable && handlesOnlyHorizontal ? ['e', 'w'] : HANDLES;
  const tl = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;

  return (
    <div
      data-testid="selection-overlay"
      aria-hidden={resizable ? undefined : true}
      style={{
        position: 'fixed',
        left: tl.x,
        top: tl.y,
        width,
        height,
        boxSizing: 'border-box',
        border: `1px solid ${SELECTION_COLOR}`,
        pointerEvents: 'none',
        zIndex: 10000,
      }}
    >
      {resizable &&
        handles.map((handle) => (
          <div
            key={handle}
            role="button"
            data-handle={handle}
            aria-label={`Resize ${HANDLE_LABELS[handle]}`}
            onPointerDown={(e) => onHandlePointerDown(e, handle)}
            style={handleStyle(handle)}
          />
        ))}
    </div>
  );
}
