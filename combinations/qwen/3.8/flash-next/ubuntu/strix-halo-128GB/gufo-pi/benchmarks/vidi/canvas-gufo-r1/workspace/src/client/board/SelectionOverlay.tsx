import { worldToScreen, type Camera } from '../canvas/camera';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';
import { HANDLE_SIZE_PX } from '../../shared/config';

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

const HANDLE_POSITIONS: Array<{ handle: Handle; label: string }> = [
  { handle: 'nw', label: 'Resize top-left' },
  { handle: 'n', label: 'Resize top' },
  { handle: 'ne', label: 'Resize top-right' },
  { handle: 'e', label: 'Resize right' },
  { handle: 'se', label: 'Resize bottom-right' },
  { handle: 's', label: 'Resize bottom' },
  { handle: 'sw', label: 'Resize bottom-left' },
  { handle: 'w', label: 'Resize left' },
];

/**
 * Renders the bounding box and 8 resize handles around a selection in screen space.
 * Also renders outlines (via CSS) on selected objects (handled by object components using data-selected).
 */
export function SelectionOverlay(props: SelectionOverlayProps) {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  if (ids.size === 0) return null;

  // Gather bounds of selected objects
  const selectedSnaps = snapshot.filter((obj) => ids.has(obj.id));
  const rects: Rect[] = selectedSnaps.map((obj) => objectBounds(obj));
  const bbox = unionRects(rects);

  if (!bbox) return null;

  // Check if any selected type is resizable
  let anyResizable = false;
  for (const obj of selectedSnaps) {
    const spec = getObjectType(obj.type);
    if (spec && spec.resizable) {
      anyResizable = true;
      break;
    }
  }

  // Convert bbox to screen space
  const topLeft = worldToScreen(camera, { x: bbox.x, y: bbox.y });
  const bottomRight = worldToScreen(camera, { x: bbox.x + bbox.width, y: bbox.y + bbox.height });

  const screenRect = {
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };

  // Calculate handle positions in screen space
  const handlePositions = getHandlePositions(screenRect, HANDLE_SIZE_PX);

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* Bounding box outline */}
      <div
        data-testid="selection-bbox"
        style={{
          position: 'absolute',
          left: screenRect.left,
          top: screenRect.top,
          width: screenRect.width,
          height: screenRect.height,
          border: '1.5px solid #2563eb',
          pointerEvents: 'none',
          boxSizing: 'border-box',
        }}
      />
      {/* Resize handles */}
      {anyResizable && HANDLE_POSITIONS.map(({ handle, label }) => {
        const pos = handlePositions[handle];
        return (
          <button
            key={handle}
            type="button"
            aria-label={label}
            data-testid={`handle-${handle}`}
            className="selection-handle"
            style={{
              position: 'absolute',
              left: pos.x - HANDLE_SIZE_PX / 2,
              top: pos.y - HANDLE_SIZE_PX / 2,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              backgroundColor: '#fff',
              border: '1.5px solid #2563eb',
              borderRadius: 1,
              padding: 0,
              cursor: getCursorForHandle(handle),
              pointerEvents: 'auto',
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onHandlePointerDown(e.nativeEvent as unknown as PointerEvent, handle);
            }}
          />
        );
      })}
    </div>
  );
}

function getHandlePositions(
  rect: { left: number; top: number; width: number; height: number },
  _handleSize: number,
): Record<Handle, { x: number; y: number }> {
  const { left, top, width, height } = rect;
  const cx = left + width / 2;
  const cy = top + height / 2;
  return {
    nw: { x: left, y: top },
    n: { x: cx, y: top },
    ne: { x: left + width, y: top },
    e: { x: left + width, y: cy },
    se: { x: left + width, y: top + height },
    s: { x: cx, y: top + height },
    sw: { x: left, y: top + height },
    w: { x: left, y: cy },
  };
}

function getCursorForHandle(handle: Handle): string {
  switch (handle) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
  }
}
