import { useMemo, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import { HANDLE_SIZE_PX, SELECTION_COLOR } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, HANDLE_LABEL, type Handle, type Rect } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Each handle as a fraction of the box (0 = start, 0.5 = middle, 1 = end).
const HANDLE_POS: Record<Handle, { x: number; y: number }> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};

const CURSOR: Record<Handle, string> = {
  nw: 'nwse-resize',
  n: 'ns-resize',
  ne: 'nesw-resize',
  e: 'ew-resize',
  se: 'nwse-resize',
  s: 'ns-resize',
  sw: 'nesw-resize',
  w: 'ew-resize',
};

export interface SelectionOverlayProps {
  snapshot: readonly ObjectSnapshot[];
  ids: ReadonlySet<string>;
  camera: Camera;
  onHandlePointerDown(event: ReactPointerEvent<HTMLElement>, handle: Handle): void;
}

/**
 * The screen-space bounding box around the current selection with eight resize
 * handles. The box follows the objects in world space (constant on-screen
 * border thickness); only the handles are interactive. Handles are hidden when
 * no selected object type is resizable.
 */
export function SelectionOverlay({
  snapshot,
  ids,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): JSX.Element | null {
  const selected = useMemo(
    () => snapshot.filter((obj) => ids.has(obj.id)),
    [snapshot, ids],
  );

  if (selected.length === 0) return null;

  const rects = selected.map(objectBounds);
  const box: Rect | null = unionRects(rects);
  if (box === null) return null;

  const resizable = selected.some((obj) => {
    const spec = getObjectType(obj.type);
    return spec !== undefined && spec.resizable;
  });

  // When every selected type resizes horizontally only (text), show just the
  // east/west handles — the height follows the wrapped content (story 9).
  const horizontalOnly = selected.every((obj) => {
    const spec = getObjectType(obj.type);
    return spec !== undefined && spec.handles === 'horizontal';
  });
  const handles = horizontalOnly ? HANDLES.filter((h) => h === 'e' || h === 'w') : HANDLES;

  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const w = box.width * camera.zoom;
  const h = box.height * camera.zoom;

  return (
    <div
      aria-hidden={resizable ? undefined : true}
      data-testid="selection-overlay"
      style={{
        position: 'fixed',
        left: `${topLeft.x}px`,
        top: `${topLeft.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        border: `1px solid ${SELECTION_COLOR}`,
        pointerEvents: 'none',
        zIndex: 90,
      }}
    >
      {resizable &&
        handles.map((handle) => {
          const frac = HANDLE_POS[handle];
          const size = HANDLE_SIZE_PX;
          return (
            <div
              key={handle}
              role="button"
              aria-label={`Resize ${HANDLE_LABEL[handle]}`}
              data-testid={`resize-handle-${handle}`}
              data-handle={handle}
              onPointerDown={(event) => onHandlePointerDown(event, handle)}
              style={{
                position: 'absolute',
                left: `${frac.x * w - size / 2}px`,
                top: `${frac.y * h - size / 2}px`,
                width: `${size}px`,
                height: `${size}px`,
                boxSizing: 'border-box',
                background: '#ffffff',
                border: `1px solid ${SELECTION_COLOR}`,
                borderRadius: '1px',
                cursor: CURSOR[handle],
                pointerEvents: 'auto',
              }}
            />
          );
        })}
    </div>
  );
}
