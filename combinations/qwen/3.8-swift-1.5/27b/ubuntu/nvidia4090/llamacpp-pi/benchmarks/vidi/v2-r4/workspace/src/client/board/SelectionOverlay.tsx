import type { JSX } from 'react';
import type { Camera } from '../canvas/camera';
import type { ObjectSnapshot } from '../../shared/board-model';
import { objectBounds } from '../../shared/board-model';
import type { Rect, Handle } from '../../shared/geometry';
import { unionRects } from '../../shared/geometry';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

const HANDLE_POSITIONS: { handle: Handle; label: string; style: (rect: Rect, size: number) => React.CSSProperties }[] = [
  { handle: 'nw', label: 'Resize top-left', style: (r, s) => ({ left: r.x - s / 2, top: r.y - s / 2 }) },
  { handle: 'n', label: 'Resize top', style: (r, s) => ({ left: r.x + r.width / 2 - s / 2, top: r.y - s / 2 }) },
  { handle: 'ne', label: 'Resize top-right', style: (r, s) => ({ left: r.x + r.width - s / 2, top: r.y - s / 2 }) },
  { handle: 'e', label: 'Resize right', style: (r, s) => ({ left: r.x + r.width - s / 2, top: r.y + r.height / 2 - s / 2 }) },
  { handle: 'se', label: 'Resize bottom-right', style: (r, s) => ({ left: r.x + r.width - s / 2, top: r.y + r.height - s / 2 }) },
  { handle: 's', label: 'Resize bottom', style: (r, s) => ({ left: r.x + r.width / 2 - s / 2, top: r.y + r.height - s / 2 }) },
  { handle: 'sw', label: 'Resize bottom-left', style: (r, s) => ({ left: r.x - s / 2, top: r.y + r.height - s / 2 }) },
  { handle: 'w', label: 'Resize left', style: (r, s) => ({ left: r.x - s / 2, top: r.y + r.height / 2 - s / 2 }) },
];

export function SelectionOverlay(props: {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: React.PointerEvent, handle: Handle): void;
}): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;

  if (ids.size === 0) return null;

  // Get bounds of all selected objects
  const selectedBounds: Rect[] = [];
  for (const obj of snapshot) {
    if (ids.has(obj.id)) {
      selectedBounds.push(objectBounds(obj));
    }
  }

  if (selectedBounds.length === 0) return null;

  const boundingBox = unionRects(selectedBounds);
  if (!boundingBox) return null;

  // Check if any selected type is resizable, and whether every selected
  // type is horizontal-only (story 9: a single text shows just e/w handles;
  // mixed selections keep all handles)
  const selectedSpecs = [...ids].map((id) => {
    const obj = snapshot.find((o) => o.id === id);
    if (!obj) return undefined;
    return getObjectType(obj.type);
  });
  const anyResizable = selectedSpecs.some((spec) => spec?.resizable ?? false);
  const allHorizontal =
    anyResizable && selectedSpecs.every((spec) => (spec?.handles ?? 'all') === 'horizontal');

  const visibleHandles = allHorizontal
    ? HANDLE_POSITIONS.filter(({ handle }) => handle === 'e' || handle === 'w')
    : HANDLE_POSITIONS;

  const handleSize = HANDLE_SIZE_PX / camera.zoom;

  return (
    <div data-testid="selection-overlay" style={{ position: 'absolute', pointerEvents: 'none' }}>
      {/* Bounding box outline */}
      <div
        data-testid="selection-bounding-box"
        style={{
          position: 'absolute',
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
          border: `${2 / camera.zoom}px solid #2196F3`,
          pointerEvents: 'none',
        }}
      />

      {/* Resize handles (only if any selected type is resizable) */}
      {anyResizable &&
        visibleHandles.map(({ handle, label, style }) => (
          <div
            key={handle}
            data-testid={`handle-${handle}`}
            aria-label={label}
            role="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e, handle);
            }}
            style={{
              position: 'absolute',
              ...style(boundingBox, handleSize),
              width: handleSize,
              height: handleSize,
              backgroundColor: 'white',
              border: `${1.5 / camera.zoom}px solid #2196F3`,
              cursor: `${handle}-resize`,
              pointerEvents: 'auto',
              zIndex: 10,
            }}
          />
        ))}
    </div>
  );
}
