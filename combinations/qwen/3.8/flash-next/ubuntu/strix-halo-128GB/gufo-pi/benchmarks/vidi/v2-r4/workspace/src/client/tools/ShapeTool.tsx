/**
 * ShapeTool: handles drag/click creation of shapes with preview.
 * Renders a full-viewport overlay that captures all pointer events so drags
 * over existing objects never move them (TC-28).
 */
import { useCallback, useRef, useState } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect } from '../../shared/geometry';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, type ShapeKind } from '../../shared/config';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  onCreated(id: string): void;
  /** Called on pointerdown with the world rect preview (for rendering). */
  onCreateShape(rect: { x: number; y: number; width: number; height: number } | null, at: Point, square: boolean): string | null;
  undoBoundary(): void;
}

interface PreviewState {
  screenStart: Point;
  screenEnd: Point;
  shift: boolean;
}

export function ShapeTool(props: ShapeToolProps): React.JSX.Element {
  const { kind, camera, onCreated, onCreateShape, undoBoundary } = props;
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const dragRef = useRef<PreviewState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const pointOf = useCallback((clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = containerRef.current;
      if (!el) return;
      el.setPointerCapture?.(e.pointerId);
      const p = pointOf(e.clientX, e.clientY);
      const state: PreviewState = { screenStart: p, screenEnd: p, shift: e.shiftKey };
      dragRef.current = state;
      setPreview(state);
    },
    [pointOf],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const p = pointOf(e.clientX, e.clientY);
      const state: PreviewState = {
        screenStart: dragRef.current.screenStart,
        screenEnd: p,
        shift: e.shiftKey,
      };
      dragRef.current = state;
      setPreview(state);
    },
    [pointOf],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      const el = containerRef.current;
      if (el?.hasPointerCapture?.(e.pointerId)) {
        el.releasePointerCapture(e.pointerId);
      }

      const state = dragRef.current;
      dragRef.current = null;
      setPreview(null);

      const worldStart = screenToWorld(camera, state.screenStart);
      const worldEnd = screenToWorld(camera, state.screenEnd);
      const rawRect = normalizeRect(worldStart, worldEnd);

      undoBoundary();
      const id = onCreateShape(rawRect, worldStart, state.shift);
      undoBoundary();
      if (id) {
        onCreated(id);
      }
    },
    [camera, onCreated, onCreateShape, undoBoundary],
  );

  const onPointerCancel = useCallback(() => {
    dragRef.current = null;
    setPreview(null);
  }, []);

  // Compute preview rect in screen space for rendering
  let previewRect: { left: number; top: number; width: number; height: number } | null = null;
  if (preview) {
    const sx = Math.min(preview.screenStart.x, preview.screenEnd.x);
    const sy = Math.min(preview.screenStart.y, preview.screenEnd.y);
    let sw = Math.abs(preview.screenEnd.x - preview.screenStart.x);
    let sh = Math.abs(preview.screenEnd.y - preview.screenStart.y);

    // Apply shift constraint to preview
    if (preview.shift && sw > 0 && sh > 0) {
      const larger = Math.max(sw, sh);
      sw = larger;
      sh = larger;
    }

    previewRect = { left: sx, top: sy, width: sw, height: sh };
  }

  return (
    <div
      ref={containerRef}
      data-testid="shape-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        zIndex: 10,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {previewRect && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'absolute',
            left: previewRect.left,
            top: previewRect.top,
            width: previewRect.width,
            height: previewRect.height,
            border: `2px dashed var(--stroke, ${SHAPE_STROKE_COLORS[DEFAULT_SHAPE_STROKE]})`,
            background: SHAPE_FILL_COLORS[DEFAULT_SHAPE_FILL] + '40',
            borderRadius: kind === 'ellipse' ? '50%' : 0,
          }}
        />
      )}
    </div>
  );
}
