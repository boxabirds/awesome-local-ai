import type { JSX } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { unionRects } from '../../shared/geometry';
import type { Handle } from '../../shared/geometry';
import { objectBounds } from '../../shared/board-model';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { getObjectType } from '../objects/registry';

/**
 * SelectionOverlay: per-object outlines, the bounding box and resize handles.
 * Drawn in screen space so handles stay the same size at any zoom.
 *
 * Story 9: when all selected specs declare handles: 'horizontal', only
 * e/w handles are rendered. In mixed selections all handles show.
 */

const ALL_HANDLES: Array<{ handle: Handle; label: string; dx: number; dy: number }> = [
  { handle: 'nw', label: 'Resize top-left', dx: 0, dy: 0 },
  { handle: 'n', label: 'Resize top', dx: 0.5, dy: 0 },
  { handle: 'ne', label: 'Resize top-right', dx: 1, dy: 0 },
  { handle: 'e', label: 'Resize right', dx: 1, dy: 0.5 },
  { handle: 'se', label: 'Resize bottom-right', dx: 1, dy: 1 },
  { handle: 's', label: 'Resize bottom', dx: 0.5, dy: 1 },
  { handle: 'sw', label: 'Resize bottom-left', dx: 0, dy: 1 },
  { handle: 'w', label: 'Resize left', dx: 0, dy: 0.5 },
];

const HORIZONTAL_HANDLES: Array<{ handle: Handle; label: string; dx: number; dy: number }> = [
  { handle: 'e', label: 'Resize right', dx: 1, dy: 0.5 },
  { handle: 'w', label: 'Resize left', dx: 0, dy: 0.5 },
];

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

export function SelectionOverlay(props: SelectionOverlayProps): JSX.Element | null {
  const { ids, snapshot, camera, onHandlePointerDown } = props;
  if (ids.size === 0) return null;

  // Collect the rects of selected objects.
  const selectedSnapshots = snapshot.filter((obj) => ids.has(obj.id));
  if (selectedSnapshots.length === 0) return null;

  const rects = selectedSnapshots.map((obj) => objectBounds(obj));
  const boundingBox = unionRects(rects);
  if (!boundingBox) return null;

  // Determine which handles to show.
  let handles = ALL_HANDLES;
  if (ids.size === 1) {
    // Single selection: check the spec's `handles` field.
    const obj = selectedSnapshots[0]!;
    const spec = getObjectType(obj.type);
    if (spec && spec.handles === 'horizontal') {
      handles = HORIZONTAL_HANDLES;
    }
  } else {
    // Mixed selection: if ALL specs declare 'horizontal', show only e/w.
    const allHorizontal = selectedSnapshots.every((obj) => {
      const spec = getObjectType(obj.type);
      return spec && spec.handles === 'horizontal';
    });
    if (allHorizontal) {
      handles = HORIZONTAL_HANDLES;
    }
  }

  // Convert bounding box to screen coords.
  const screenOrigin = worldToScreen(camera, { x: boundingBox.x, y: boundingBox.y });
  const screenW = boundingBox.width * camera.zoom;
  const screenH = boundingBox.height * camera.zoom;
  const hs = HANDLE_SIZE_PX;

  return (
    <>
      {/* Per-object outlines */}
      {selectedSnapshots.map((obj) => {
        const b = objectBounds(obj);
        const s = worldToScreen(camera, { x: b.x, y: b.y });
        const w = b.width * camera.zoom;
        const h = b.height * camera.zoom;
        return (
          <div
            key={obj.id}
            data-testid="local-selection-outline"
            data-outline-id={obj.id}
            style={{
              position: 'absolute',
              left: s.x - 1,
              top: s.y - 1,
              width: w + 2,
              height: h + 2,
              border: '1px solid rgba(66, 133, 244, 0.8)',
              pointerEvents: 'none',
            }}
          />
        );
      })}

      {/* Bounding box */}
      {ids.size > 1 ? (
        <div
          data-testid="selection-bounding-box"
          style={{
            position: 'absolute',
            left: screenOrigin.x,
            top: screenOrigin.y,
            width: screenW,
            height: screenH,
            border: '1px solid rgba(66, 133, 244, 0.5)',
            pointerEvents: 'none',
          }}
        />
      ) : null}

      {/* Handles */}
      {handles.map(({ handle, label, dx, dy }) => {
        const hx = screenOrigin.x + screenW * dx - hs / 2;
        const hy = screenOrigin.y + screenH * dy - hs / 2;
        return (
          <button
            key={handle}
            type="button"
            aria-label={label}
            data-testid={`handle-${handle}`}
            style={{
              position: 'absolute',
              left: hx,
              top: hy,
              width: hs,
              height: hs,
              padding: 0,
              border: '1px solid #4285F4',
              backgroundColor: '#fff',
              borderRadius: 0,
              cursor: 'pointer',
              pointerEvents: 'auto',
              zIndex: 10,
              minWidth: hs,
              minHeight: hs,
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e.nativeEvent as unknown as PointerEvent, handle);
            }}
          />
        );
      })}
    </>
  );
}