import { useMemo } from 'react';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { unionRects, type Handle } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const HANDLE_LABELS: Record<Handle, string> = {
  nw: 'Resize top-left',
  n: 'Resize top',
  ne: 'Resize top-right',
  e: 'Resize right',
  se: 'Resize bottom-right',
  s: 'Resize bottom',
  sw: 'Resize bottom-left',
  w: 'Resize left',
};

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, handle: Handle): void;
}

/**
 * Renders the bounding box and 8 resize handles around the selection in screen space.
 * Handles stay at HANDLE_SIZE_PX regardless of zoom.
 */
export function SelectionOverlay({ ids, snapshot, camera, onHandlePointerDown }: SelectionOverlayProps) {
  const selectedObjects = useMemo(
    () => snapshot.filter((o) => ids.has(o.id)),
    [ids, snapshot],
  );

  const boundingBox = useMemo(() => {
    const rects = selectedObjects.map(objectBounds);
    return unionRects(rects);
  }, [selectedObjects]);

  if (!boundingBox || selectedObjects.length === 0) return null;

  const { zoom, x: camX, y: camY } = camera;
  // Convert world to screen coordinates
  const screenX = (boundingBox.x - camX) * zoom;
  const screenY = (boundingBox.y - camY) * zoom;
  const screenW = boundingBox.width * zoom;
  const screenH = boundingBox.height * zoom;
  const half = HANDLE_SIZE_PX / 2;

  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{
        position: 'absolute',
        left: screenX - half,
        top: screenY - half,
        width: screenW + HANDLE_SIZE_PX,
        height: screenH + HANDLE_SIZE_PX,
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      {/* Bounding box border */}
      <div
        style={{
          position: 'absolute',
          left: half,
          top: half,
          width: screenW,
          height: screenH,
          border: '1px solid #1a73e8',
          pointerEvents: 'none',
        }}
      />
      {/* 8 handles */}
      {HANDLES.map((h) => {
        const pos = handlePosition(h, screenW, screenH);
        return (
          <button
            key={h}
            type="button"
            className="selection-handle"
            aria-label={HANDLE_LABELS[h]}
            data-testid={`handle-${h}`}
            style={{
              position: 'absolute',
              left: pos.x - half,
              top: pos.y - half,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              background: '#fff',
              border: '2px solid #1a73e8',
              borderRadius: 1,
              cursor: handleCursor(h),
              pointerEvents: 'auto',
              padding: 0,
              boxSizing: 'border-box',
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onHandlePointerDown(e.nativeEvent, h);
            }}
          />
        );
      })}
    </div>
  );
}

function handlePosition(h: Handle, w: number, hh: number): { x: number; y: number } {
  const cx = w / 2;
  const cy = hh / 2;
  switch (h) {
    case 'nw': return { x: 0, y: 0 };
    case 'n': return { x: cx, y: 0 };
    case 'ne': return { x: w, y: 0 };
    case 'e': return { x: w, y: cy };
    case 'se': return { x: w, y: hh };
    case 's': return { x: cx, y: hh };
    case 'sw': return { x: 0, y: hh };
    case 'w': return { x: 0, y: cy };
  }
}

function handleCursor(h: Handle): string {
  switch (h) {
    case 'nw': case 'se': return 'nwse-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
  }
}
