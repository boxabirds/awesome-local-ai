// Shape tool: drag/click creation with preview (story 10).
// Captures the pointer so drags starting over existing objects never move them.

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type * as Y from 'yjs';

interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  onCreated(id: string): void;
  onBoundary?: () => void;
}

interface DragState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  square: boolean;
}

export function ShapeTool({ kind, camera, doc, onCreated, onBoundary }: ShapeToolProps): React.ReactElement {
  const [drag, setDrag] = useState<DragState | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    // Use raw clientX/clientY (screen coords) — screenToWorld handles the camera.
    setDrag({ startX: e.clientX, startY: e.clientY, endX: e.clientX, endY: e.clientY, square: e.shiftKey });
  }, []);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.stopPropagation();
    setDrag((prev) => prev ? { ...prev, endX: e.clientX, endY: e.clientY, square: e.shiftKey } : null);
  }, [drag]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.stopPropagation();
    const state = drag;
    setDrag(null);

    // Convert to world coordinates
    const startWorld = screenToWorld(camera, { x: state.startX, y: state.startY });
    const endWorld = screenToWorld(camera, { x: state.endX, y: state.endY });

    // Determine if this is a click (tiny drag) or a real drag
    const w = Math.abs(endWorld.x - startWorld.x);
    const h = Math.abs(endWorld.y - startWorld.y);

    let rect: { x: number; y: number; width: number; height: number } | null;
    if (w < 20 || h < 20) {
      // Click or tiny drag: rect is null (default size at click point)
      rect = null;
    } else {
      rect = {
        x: Math.min(startWorld.x, endWorld.x),
        y: Math.min(startWorld.y, endWorld.y),
        width: w,
        height: h,
      };
    }

    onBoundary?.();
    const id = createShape(doc, {
      kind,
      rect,
      at: startWorld,
      square: state.square,
    }, 'local');
    onBoundary?.();

    if (id) {
      onCreated(id);
    }
  }, [drag, camera, doc, kind, onCreated, onBoundary]);

  const handlePointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setDrag(null);
  }, []);

  // Compute preview rect in world space (convert from screen coords)
  let preview: { x: number; y: number; width: number; height: number } | null = null;
  if (drag) {
    const startW = screenToWorld(camera, { x: drag.startX, y: drag.startY });
    const endW = screenToWorld(camera, { x: drag.endX, y: drag.endY });
    let px = Math.min(startW.x, endW.x);
    let py = Math.min(startW.y, endW.y);
    let pw = Math.abs(endW.x - startW.x);
    let ph = Math.abs(endW.y - startW.y);
    if (drag.square) {
      const size = Math.max(pw, ph);
      if (endW.x < startW.x) px = startW.x - size;
      if (endW.y < startW.y) py = startW.y - size;
      pw = size;
      ph = size;
    }
    preview = { x: px, y: py, width: pw, height: ph };
  }

  return (
    <div
      ref={ref}
      data-testid="shape-tool"
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 10,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {preview && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'absolute',
            left: worldToScreen(camera, { x: preview.x, y: preview.y }).x,
            top: worldToScreen(camera, { x: preview.x, y: preview.y }).y,
            width: preview.width * camera.zoom,
            height: preview.height * camera.zoom,
            border: '2px dashed #1976D2',
            borderRadius: kind === 'ellipse' ? '50%' : '0',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
