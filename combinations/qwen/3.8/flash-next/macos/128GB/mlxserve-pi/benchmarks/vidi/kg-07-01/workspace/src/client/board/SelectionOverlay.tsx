import { useMemo, useRef } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import { unionRects, type Handle, type Rect } from '../../shared/geometry';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import { HANDLE_SIZE_PX } from '../../shared/config';
import { getObjectType } from '../objects/registry';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

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

function handlePosition(rect: Rect, h: Handle): Point {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  switch (h) {
    case 'nw': return { x: rect.x, y: rect.y };
    case 'n': return { x: cx, y: rect.y };
    case 'ne': return { x: rect.x + rect.width, y: rect.y };
    case 'e': return { x: rect.x + rect.width, y: cy };
    case 'se': return { x: rect.x + rect.width, y: rect.y + rect.height };
    case 's': return { x: cx, y: rect.y + rect.height };
    case 'sw': return { x: rect.x, y: rect.y + rect.height };
    case 'w': return { x: rect.x, y: cy };
  }
}

export interface SelectionOverlayProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  camera: Camera;
  onHandlePointerDown(e: PointerEvent, h: Handle): void;
  onHandlePointerMove?(e: PointerEvent): void;
  onHandlePointerUp?(e: PointerEvent): void;
  onHandlePointerCancel?(e: PointerEvent): void;
}

/** Renders per-object outlines, a bounding box, and 8 resize handles in screen space. */
export function SelectionOverlay(props: SelectionOverlayProps) {
  const { ids, snapshot, camera, onHandlePointerDown, onHandlePointerMove, onHandlePointerUp, onHandlePointerCancel } = props;

  const selectedObjects = useMemo(() => {
    return snapshot.filter((o) => ids.has(o.id));
  }, [snapshot, ids]);

  const boundingBox = useMemo(() => {
    const rects = selectedObjects.map((o) => objectBounds(o));
    return unionRects(rects);
  }, [selectedObjects]);

  // Check if any selected type is resizable.
  const anyResizable = useMemo(() => {
    for (const obj of selectedObjects) {
      const spec = getObjectType(obj.type);
      if (spec && spec.resizable) return true;
    }
    return false;
  }, [selectedObjects]);

  // Register window listeners imperatively on pointerdown for reliable E2E timing.
  const cleanupRef = useRef<(() => void) | null>(null);

  const startHandleDrag = (e: React.PointerEvent<HTMLDivElement>, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    onHandlePointerDown(e.nativeEvent, h);
    // Immediately register window listeners (not via useEffect to avoid timing gaps).
    if (cleanupRef.current) cleanupRef.current();
    const onMove = (ev: PointerEvent) => { onHandlePointerMove?.(ev); };
    const onUp = (ev: PointerEvent) => {
      onHandlePointerUp?.(ev);
      cleanup();
    };
    const onCancel = (ev: PointerEvent) => {
      onHandlePointerCancel?.(ev);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      cleanupRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    cleanupRef.current = cleanup;
  };

  if (selectedObjects.length === 0 || !boundingBox) return null;

  const screenBox = {
    x: (boundingBox.x - camera.x) * camera.zoom,
    y: (boundingBox.y - camera.y) * camera.zoom,
    width: boundingBox.width * camera.zoom,
    height: boundingBox.height * camera.zoom,
  };

  return (
    <>
      {/* Bounding box */}
      <div
        className="selection-bounding-box"
        style={{
          position: 'absolute',
          left: screenBox.x,
          top: screenBox.y,
          width: screenBox.width,
          height: screenBox.height,
          border: '1px solid #4A90D9',
          pointerEvents: 'none',
          zIndex: 9998,
        }}
        aria-hidden="true"
      />
      {/* Handles */}
      {anyResizable && HANDLES.map((h) => {
        const worldPos = handlePosition(boundingBox, h);
        const screenPos = worldToScreen(camera, worldPos);
        const half = HANDLE_SIZE_PX / 2;
        return (
          <div
            key={h}
            className="selection-handle"
            data-handle={h}
            aria-label={`Resize ${HANDLE_LABELS[h]}`}
            style={{
              position: 'absolute',
              left: screenPos.x - half,
              top: screenPos.y - half,
              width: HANDLE_SIZE_PX,
              height: HANDLE_SIZE_PX,
              backgroundColor: '#fff',
              border: '1px solid #4A90D9',
              cursor: `${h}-resize`,
              zIndex: 9999,
            }}
            onPointerDown={(e) => startHandleDrag(e, h)}
          />
        );
      })}
    </>
  );
}
