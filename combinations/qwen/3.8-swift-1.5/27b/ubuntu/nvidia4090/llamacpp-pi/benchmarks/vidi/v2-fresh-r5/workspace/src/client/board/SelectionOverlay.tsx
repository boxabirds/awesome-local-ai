import type { JSX } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { Rect, Handle } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

const ALL_HANDLES: { handle: Handle; label: string; pos: (r: Rect) => Point }[] = [
  { handle: 'nw', label: 'Resize top-left', pos: (r) => ({ x: r.x, y: r.y }) },
  { handle: 'n', label: 'Resize top', pos: (r) => ({ x: r.x + r.width / 2, y: r.y }) },
  { handle: 'ne', label: 'Resize top-right', pos: (r) => ({ x: r.x + r.width, y: r.y }) },
  { handle: 'e', label: 'Resize right', pos: (r) => ({ x: r.x + r.width, y: r.y + r.height / 2 }) },
  { handle: 'se', label: 'Resize bottom-right', pos: (r) => ({ x: r.x + r.width, y: r.y + r.height }) },
  { handle: 's', label: 'Resize bottom', pos: (r) => ({ x: r.x + r.width / 2, y: r.y + r.height }) },
  { handle: 'sw', label: 'Resize bottom-left', pos: (r) => ({ x: r.x, y: r.y + r.height }) },
  { handle: 'w', label: 'Resize left', pos: (r) => ({ x: r.x, y: r.y + r.height / 2 }) },
];

const HORIZONTAL_HANDLES: { handle: Handle; label: string; pos: (r: Rect) => Point }[] = [
  { handle: 'e', label: 'Resize right', pos: (r) => ({ x: r.x + r.width, y: r.y + r.height / 2 }) },
  { handle: 'w', label: 'Resize left', pos: (r) => ({ x: r.x, y: r.y + r.height / 2 }) },
];

interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown: (e: React.PointerEvent, handle: Handle) => void;
}

/**
 * Renders the selection bounding box and 8 resize handles in screen space.
 * Handles are hidden when no selected type is resizable.
 */
export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  if (ids.size === 0) return null;

  // Compute bounding box in world space
  const rects: Rect[] = [];
  let anyResizable = false;
  let allHorizontal = true;
  for (const id of ids) {
    const obj = snapshot.find((o) => o.id === id);
    if (!obj) continue;
    rects.push(objectBounds(obj));
    const spec = getObjectType(obj.type);
    if (spec?.resizable) anyResizable = true;
    if (spec?.handles !== 'horizontal') allHorizontal = false;
  }

  const bounds = unionRects(rects);
  if (!bounds) return null;

  // Convert to screen space
  const screenTL = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  const screenW = bounds.width * camera.zoom;
  const screenH = bounds.height * camera.zoom;

  const handleCursorMap: Record<Handle, string> = {
    n: 'ns-resize', s: 'ns-resize',
    e: 'ew-resize', w: 'ew-resize',
    ne: 'nesw-resize', sw: 'nesw-resize',
    nw: 'nwse-resize', se: 'nwse-resize',
  };

  return (
    <div
      data-testid="selection-overlay"
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 999 }}
    >
      {/* Bounding box outline */}
      <div
        data-testid="selection-bounds"
        style={{
          position: 'absolute',
          left: `${screenTL.x}px`,
          top: `${screenTL.y}px`,
          width: `${screenW}px`,
          height: `${screenH}px`,
          border: '1.5px solid #1a73e8',
          pointerEvents: 'none',
        }}
      />

      {/* Resize handles */}
      {anyResizable &&
        (allHorizontal ? HORIZONTAL_HANDLES : ALL_HANDLES).map(({ handle, label, pos }) => {
          const worldPos = pos(bounds);
          const screenPos = worldToScreen(camera, worldPos);
          return (
            <div
              key={handle}
              data-testid={`handle-${handle}`}
              role="button"
              aria-label={label}
              onPointerDown={(e) => {
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
              style={{
                position: 'absolute',
                left: `${screenPos.x - HANDLE_SIZE_PX / 2}px`,
                top: `${screenPos.y - HANDLE_SIZE_PX / 2}px`,
                width: `${HANDLE_SIZE_PX}px`,
                height: `${HANDLE_SIZE_PX}px`,
                background: 'white',
                border: '1.5px solid #1a73e8',
                cursor: handleCursorMap[handle],
                pointerEvents: 'auto',
                boxSizing: 'border-box',
              }}
            />
          );
        })}
    </div>
  );
}
