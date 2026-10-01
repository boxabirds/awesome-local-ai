import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { type ShapeKind, SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { normalizeRect } from '../../shared/geometry';
import type { Rect, Point } from '../../shared/geometry';

/**
 * ShapeTool: overlay component that captures pointer events while the Shape tool is active.
 * Draws a dashed preview during drag, creates a shape on pointerup.
 *
 * The tool captures the pointer so drags starting over existing objects never move them.
 */
export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  /** Container element ref for pointer capture */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Called to create a shape with given params; returns id or null */
  createShape(params: { kind: ShapeKind; rect: Rect | null; at: Point; square: boolean }): string | null;
}

interface DragState {
  startScreen: Point;
  startWorld: Point;
  currentWorld: Point;
  shift: boolean;
}

export function ShapeTool({ kind, camera, onCreated, createShape }: ShapeToolProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Only left button
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const screen = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(camera, screen);
    const state: DragState = { startScreen: screen, startWorld: world, currentWorld: world, shift: e.shiftKey };
    dragRef.current = state;
    setDrag(state);
    // Capture pointer on the overlay
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }, [camera]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const state = { ...dragRef.current, currentWorld: world, shift: e.shiftKey };
    dragRef.current = state;
    setDrag(state);
  }, [camera]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    const state = dragRef.current;
    dragRef.current = null;
    setDrag(null);

    const world = screenToWorld(camera, { x: e.clientX, y: e.clientY });
    const rect = normalizeRect(state.startWorld, world);

    // Determine if this is a click (too small) or a drag
    const isClick = rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;

    const id = createShape({
      kind,
      rect: isClick ? null : rect,
      at: state.startWorld,
      square: state.shift,
    });

    if (id) {
      onCreated(id);
    }
  }, [camera, kind, createShape, onCreated]);

  const handlePointerCancel = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  // Render preview rect in screen space
  const preview = (() => {
    if (!drag) return null;
    const norm = normalizeRect(drag.startWorld, drag.currentWorld);
    let { width, height } = norm;
    if (drag.shift) {
      const side = Math.max(width, height);
      width = side;
      height = side;
    }
    return { x: norm.x, y: norm.y, width, height };
  })();

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        zIndex: 5,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {preview && (
        <svg
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <rect
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            fill="rgba(187,222,251,0.3)"
            stroke="#1E88E5"
            strokeWidth={1 / camera.zoom}
            strokeDasharray={`${4 / camera.zoom}`}
          />
        </svg>
      )}
    </div>
  );
}
