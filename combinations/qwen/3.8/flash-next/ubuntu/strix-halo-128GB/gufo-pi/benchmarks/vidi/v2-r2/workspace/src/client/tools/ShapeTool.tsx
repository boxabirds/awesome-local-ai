import { useRef, useCallback, type ReactElement } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point } from '@client/canvas/camera';
import { normalizeRect } from '@shared/geometry';
import { createShape } from '@shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD, type ShapeKind } from '@shared/config';
import type { Rect } from '@shared/geometry';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  viewportEl: HTMLElement | null;
  onCreated(id: string): void;
  onGestureBoundary?(): void;
}

interface DragState {
  startScreen: Point;
  currentScreen: Point;
  shift: boolean;
}

/**
 * ShapeTool: captures pointer events on the board to create shapes by dragging.
 * Renders as a transparent overlay that captures all pointer events.
 */
export function ShapeTool({
  kind,
  camera,
  doc,
  viewportEl,
  onCreated,
  onGestureBoundary,
}: ShapeToolProps): ReactElement {
  const draggingRef = useRef<DragState | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const getLocalPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    if (!viewportEl) return { x: 0, y: 0 };
    const rect = viewportEl.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, [viewportEl]);

  const computeWorldRect = useCallback((start: Point, end: Point, shift: boolean): Rect => {
    const worldStart = screenToWorld(camera, start);
    const worldEnd = screenToWorld(camera, end);
    let r = normalizeRect(worldStart, worldEnd);
    if (shift) {
      const size = Math.max(r.width, r.height);
      r = { x: r.x, y: r.y, width: size, height: size };
    }
    return r;
  }, [camera]);

  const updatePreview = useCallback((drag: DragState) => {
    const el = previewRef.current;
    if (!el) return;
    const r = computeWorldRect(drag.startScreen, drag.currentScreen, drag.shift);
    const screenTL = {
      x: (r.x - camera.x) * camera.zoom,
      y: (r.y - camera.y) * camera.zoom,
    };
    el.style.left = `${screenTL.x}px`;
    el.style.top = `${screenTL.y}px`;
    el.style.width = `${r.width * camera.zoom}px`;
    el.style.height = `${r.height * camera.zoom}px`;
    el.style.display = 'block';
  }, [camera, computeWorldRect]);

  const hidePreview = useCallback(() => {
    const el = previewRef.current;
    if (el) el.style.display = 'none';
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = getLocalPoint(e);
    draggingRef.current = { startScreen: pt, currentScreen: pt, shift: e.shiftKey };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, [getLocalPoint]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const pt = getLocalPoint(e);
    draggingRef.current.currentScreen = pt;
    draggingRef.current.shift = e.shiftKey;
    updatePreview(draggingRef.current);
  }, [getLocalPoint, updatePreview]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const drag = draggingRef.current;
    draggingRef.current = null;
    hidePreview();

    const endScreen = getLocalPoint(e);
    const worldStart = screenToWorld(camera, drag.startScreen);
    const rect = computeWorldRect(drag.startScreen, endScreen, drag.shift);

    const isTinyDrag = rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;

    if (onGestureBoundary) onGestureBoundary();
    const id = createShape(
      doc,
      { kind, rect: isTinyDrag ? null : rect, at: worldStart, square: drag.shift },
      'local',
    );
    if (onGestureBoundary) onGestureBoundary();

    if (id) {
      onCreated(id);
    }
  }, [camera, doc, kind, getLocalPoint, hidePreview, computeWorldRect, onCreated, onGestureBoundary]);

  const handlePointerCancel = useCallback(() => {
    draggingRef.current = null;
    hidePreview();
  }, [hidePreview]);

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        cursor: 'crosshair',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div
        ref={previewRef}
        data-testid="shape-preview"
        style={{
          display: 'none',
          position: 'absolute',
          border: '2px dashed #666',
          background: 'rgba(100,100,100,0.1)',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
