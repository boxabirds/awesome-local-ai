/**
 * Selection bounding box + resize handles, rendered in screen space (story 7,
 * sel.marquee_ui / handles). Handles only appear when at least one selected
 * object type is resizable. When ALL selected specs declare `handles: 'horizontal'`,
 * only e and w handles are shown (story 9, text.height).
 */
import type { PointerEvent as ReactPointerEvent, JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { HANDLES, type Handle } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { useBoardCamera } from '../canvas/BoardViewport';
import { worldToScreen } from '../canvas/camera';
import { selectionBounds } from './selectionBounds';
import { getObjectType } from '../objects/registry';

const HANDLE_POS: Record<Handle, { left: number; top: number }> = {
  nw: { left: 0, top: 0 },
  n: { left: 0.5, top: 0 },
  ne: { left: 1, top: 0 },
  e: { left: 1, top: 0.5 },
  se: { left: 1, top: 1 },
  s: { left: 0.5, top: 1 },
  sw: { left: 0, top: 1 },
  w: { left: 0, top: 0.5 },
};

const CURSOR: Record<Handle, string> = {
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

export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onHandlePointerDown(e: ReactPointerEvent, handle: Handle): void;
}): JSX.Element | null {
  const { camera } = useBoardCamera();
  const bounds = selectionBounds(props.ids, props.snapshot);
  if (!bounds || props.ids.size === 0) return null;

  let anyResizable = false;
  let allHorizontal = true;
  for (const id of props.ids) {
    const obj = props.snapshot.find((o) => o.id === id);
    if (!obj) continue;
    const spec = getObjectType(obj.type);
    if (!spec) continue;
    if (spec.resizable) anyResizable = true;
    if (spec.handles !== 'horizontal') allHorizontal = false;
  }

  const visibleHandles = allHorizontal ? HORIZONTAL_HANDLES : HANDLES;

  const tl = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const w = bounds.width * camera.zoom;
  const h = bounds.height * camera.zoom;
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        left: `${tl.x}px`,
        top: `${tl.y}px`,
        width: `${w}px`,
        height: `${h}px`,
        pointerEvents: 'none',
      }}
    >
      {anyResizable &&
        visibleHandles.map((label) => {
          const pos = HANDLE_POS[label];
          return (
            <div
              key={label}
              className="resize-handle"
              data-resize-handle={label}
              role="button"
              aria-label={`Resize ${label}`}
              style={{
                position: 'absolute',
                left: `${pos.left * w - half}px`,
                top: `${pos.top * h - half}px`,
                width: `${HANDLE_SIZE_PX}px`,
                height: `${HANDLE_SIZE_PX}px`,
                cursor: CURSOR[label],
                pointerEvents: 'auto',
              }}
              onPointerDown={(e) => props.onHandlePointerDown(e, label)}
            />
          );
        })}
    </div>
  );
}
