/**
 * Shape tool (story 10). Drag/click creation with preview.
 */
import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { createShape } from '../../shared/objects/shape';
import type { ShapeKind } from '../../shared/config';
import type * as Y from 'yjs';
import { normalizeRect } from '../../shared/geometry';

interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  onCreated: (id: string) => void;
}

interface PreviewState {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shape tool overlay. Captures pointer events for shape creation.
 * - Drag: creates a shape covering the dragged area
 * - Click (or tiny drag): creates a default-size shape centred at the click
 * - Shift: constrains to square/circle
 */
export function ShapeTool(props: ShapeToolProps): JSX.Element | null {
  const { kind, camera, doc, onCreated } = props;
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
    setPreview(null);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    e.preventDefault();

    const startScreen = dragStart.current;
    const dx = e.clientX - startScreen.x;
    const dy = e.clientY - startScreen.y;

    // Check if we've moved enough to start a drag
    if (!isDragging.current && Math.hypot(dx, dy) < 3) return;
    isDragging.current = true;

    const startWorld = screenToWorld(camera, startScreen);
    const currentWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    let rect = normalizeRect(startWorld, currentWorld);

    // Shift constraint: make square using the larger dimension
    if (e.shiftKey) {
      const size = Math.max(rect.width, rect.height);
      rect = { x: startWorld.x, y: startWorld.y, width: size, height: size };
    }

    setPreview(rect);
  }, [camera]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    e.preventDefault();
    e.stopPropagation();

    const startScreen = dragStart.current;
    const startWorld = screenToWorld(camera, startScreen);
    const endWorld = screenToWorld(camera, { x: e.clientX, y: e.clientY });

    let rect: { x: number; y: number; width: number; height: number } | null;

    if (!isDragging.current) {
      // Click: create default size at the point
      rect = null;
    } else {
      rect = normalizeRect(startWorld, endWorld);
      // Shift constraint
      if (e.shiftKey) {
        const size = Math.max(rect.width, rect.height);
        rect = { x: startWorld.x, y: startWorld.y, width: size, height: size };
      }
    }

    const id = createShape(doc, { kind, rect, at: startWorld }, 'local');
    if (id) {
      onCreated(id);
    }

    dragStart.current = null;
    isDragging.current = false;
    setPreview(null);
  }, [camera, doc, kind, onCreated]);

  const handlePointerCancel = useCallback(() => {
    dragStart.current = null;
    isDragging.current = false;
    setPreview(null);
  }, []);

  return (
    <svg
      data-testid="shape-tool-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'all',
        cursor: 'crosshair',
        zIndex: 50,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {preview && (
        <rect
          x={(preview.x - camera.x) * camera.zoom}
          y={(preview.y - camera.y) * camera.zoom}
          width={preview.width * camera.zoom}
          height={preview.height * camera.zoom}
          fill="rgba(26, 115, 232, 0.1)"
          stroke="#1a73e8"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
