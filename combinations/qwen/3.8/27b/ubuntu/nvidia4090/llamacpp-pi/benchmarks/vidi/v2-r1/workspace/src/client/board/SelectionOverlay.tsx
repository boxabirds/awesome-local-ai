// SelectionOverlay (story 7, sel.transform): the screen-space bounding box
// of the current selection with its eight resize handles. Handles are the
// same size on screen at any zoom (HANDLE_SIZE_PX) and are hidden when no
// selected type is resizable.

import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import { unionRects, type Handle } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX } from '../../shared/config';

const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_POSITIONS: Record<Handle, string> = {
  nw: 'top-left',
  n: 'top',
  ne: 'top-right',
  e: 'right',
  se: 'bottom-right',
  s: 'bottom',
  sw: 'bottom-left',
  w: 'left',
};

/** Screen-space offsets of a handle inside the bounding box. */
function handlePosition(h: Handle, width: number, height: number): { left: number; top: number } {
  const half = HANDLE_SIZE_PX / 2;
  switch (h) {
    case 'nw':
      return { left: -half, top: -half };
    case 'n':
      return { left: width / 2 - half, top: -half };
    case 'ne':
      return { left: width - HANDLE_SIZE_PX, top: -half };
    case 'e':
      return { left: width - HANDLE_SIZE_PX, top: height / 2 - half };
    case 'se':
      return { left: width - HANDLE_SIZE_PX, top: height - HANDLE_SIZE_PX };
    case 's':
      return { left: width / 2 - half, top: height - HANDLE_SIZE_PX };
    case 'sw':
      return { left: -half, top: height - HANDLE_SIZE_PX };
    case 'w':
      return { left: -half, top: height / 2 - half };
  }
}

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, h: Handle): void;
}

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const anyResizable = selected.some((o) => getObjectType(o.type)?.resizable === true);

  const topLeft = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{
        position: 'fixed',
        left: topLeft.x,
        top: topLeft.y,
        width,
        height,
        border: '1.5px solid #4285F4',
        pointerEvents: 'none',
      }}
    >
      {anyResizable &&
        HANDLES.map((h) => {
          const pos = handlePosition(h, width, height);
          return (
            <button
              key={h}
              type="button"
              className="selection-handle"
              data-handle={h}
              aria-label={`Resize ${HANDLE_POSITIONS[h]}`}
              title={`Resize ${HANDLE_POSITIONS[h]}`}
              style={{
                position: 'absolute',
                left: pos.left,
                top: pos.top,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const el = e.currentTarget;
                if (typeof el.setPointerCapture === 'function') {
                  try {
                    el.setPointerCapture(e.pointerId);
                  } catch {
                    // Ignore: best-effort (jsdom).
                  }
                }
                onHandlePointerDown(e, h);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          );
        })}
    </div>
  );
}
