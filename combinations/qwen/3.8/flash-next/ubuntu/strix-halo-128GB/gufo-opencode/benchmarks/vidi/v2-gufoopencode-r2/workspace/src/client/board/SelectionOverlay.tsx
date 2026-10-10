// Screen-space bounding box with 8 resize handles around the selection.
// Rendered as a sibling above the viewport so handles keep a constant size
// at any zoom.

import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects, type Handle } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

const HANDLE_POSITIONS: Readonly<Record<Handle, { fx: number; fy: number; label: string }>> = {
  nw: { fx: 0, fy: 0, label: 'northwest corner' },
  n: { fx: 0.5, fy: 0, label: 'north edge' },
  ne: { fx: 1, fy: 0, label: 'northeast corner' },
  e: { fx: 1, fy: 0.5, label: 'east edge' },
  se: { fx: 1, fy: 1, label: 'southeast corner' },
  s: { fx: 0.5, fy: 1, label: 'south edge' },
  sw: { fx: 0, fy: 1, label: 'southwest corner' },
  w: { fx: 0, fy: 0.5, label: 'west edge' },
};

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent<HTMLButtonElement>, handle: Handle): void;
}

export function SelectionOverlay({
  ids,
  snapshot,
  camera,
  onHandlePointerDown,
}: SelectionOverlayProps): React.JSX.Element | null {
  const selected = snapshot.filter((o) => ids.has(o.id));
  if (selected.length === 0) return null;
  const box = unionRects(selected.map(objectBounds));
  if (!box) return null;
  const anyResizable = selected.some((o) => getObjectType(o.type)?.resizable === true);
  const origin = worldToScreen(camera, { x: box.x, y: box.y });
  const width = box.width * camera.zoom;
  const height = box.height * camera.zoom;
  return (
    <div className="selection-overlay" data-testid="selection-overlay">
      <div
        className="selection-box"
        data-testid="selection-box"
        style={{ left: origin.x, top: origin.y, width, height }}
      />
      {anyResizable &&
        (Object.keys(HANDLE_POSITIONS) as Handle[]).map((handle) => {
          const { fx, fy, label } = HANDLE_POSITIONS[handle];
          return (
            <button
              key={handle}
              type="button"
              className="selection-handle"
              data-testid={`handle-${handle}`}
              aria-label={`Resize ${label}`}
              style={{
                left: origin.x + width * fx - HANDLE_SIZE_PX / 2,
                top: origin.y + height * fy - HANDLE_SIZE_PX / 2,
                width: HANDLE_SIZE_PX,
                height: HANDLE_SIZE_PX,
              }}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onHandlePointerDown(e, handle);
              }}
            />
          );
        })}
    </div>
  );
}
