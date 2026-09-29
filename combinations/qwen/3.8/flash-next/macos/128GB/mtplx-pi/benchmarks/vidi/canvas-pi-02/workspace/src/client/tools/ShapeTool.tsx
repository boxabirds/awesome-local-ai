/**
 * Shape tool component (story 10).
 *
 * Provides the drag-to-create and click-to-drop interactions for shapes.
 * Captures the pointer so drags starting over existing objects never move them.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ShapeKind } from '../../shared/config';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import type { Rect } from '../../shared/geometry';
import { normalizeRect } from '../../shared/geometry';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: import('yjs').Doc;
  onCreated(id: string): void;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}

interface PreviewState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  shiftKey: boolean;
}

export function ShapeTool(props: ShapeToolProps): JSX.Element | null {
  const { doc } = props;
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewRef = useRef<PreviewState | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const el = document.querySelector('[data-testid="board-viewport"]') as HTMLElement | null;
    if (!el) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startShift = false;

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      // The Shape tool captures ALL pointer events, even over objects.
      event.stopPropagation();
      event.preventDefault();

      const rect = el.getBoundingClientRect();
      startX = event.clientX - rect.left;
      startY = event.clientY - rect.top;
      startShift = event.shiftKey;
      dragging = true;

      const state: PreviewState = {
        startX, startY,
        endX: startX, endY: startY,
        shiftKey: startShift,
      };
      previewRef.current = state;
      setPreview(state);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      if (event.buttons === 0) {
        // Pointer released outside: cancel.
        dragging = false;
        previewRef.current = null;
        setPreview(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      const endX = event.clientX - rect.left;
      const endY = event.clientY - rect.top;
      const shift = event.shiftKey;
      const state: PreviewState = { startX, startY, endX, endY, shiftKey: shift };
      previewRef.current = state;
      setPreview(state);
    };

    const onPointerUp = (_event: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      const state = previewRef.current;
      previewRef.current = null;
      setPreview(null);

      if (!state) return;

      const cam = propsRef.current.camera;
      const p0 = screenToWorld(cam, { x: state.startX, y: state.startY });
      const p1 = screenToWorld(cam, { x: state.endX, y: state.endY });

      const rawRect = normalizeRect(p0, p1);
      const isShift = state.shiftKey;

      // Determine if this is a "click" (too small) or a proper drag.
      let rect: Rect | null;
      if (rawRect.width < SHAPE_MIN_SIZE_WORLD || rawRect.height < SHAPE_MIN_SIZE_WORLD) {
        // Click or tiny drag: create default shape at p0 (the start point).
        rect = null;
      } else {
        rect = rawRect;
      }

      const at = p0;
      const id = createShape(doc, { kind: propsRef.current.kind, rect, at, square: isShift }, 'local');
      if (id) {
        propsRef.current.onCreated(id);
      }
    };

    el.addEventListener('pointerdown', onPointerDown, true);
    el.addEventListener('pointermove', onPointerMove, true);
    el.addEventListener('pointerup', onPointerUp, true);

    return () => {
      el.removeEventListener('pointerdown', onPointerDown, true);
      el.removeEventListener('pointermove', onPointerMove, true);
      el.removeEventListener('pointerup', onPointerUp, true);
    };
  }, [doc]);

  // Render preview.
  if (!preview) return null;

  const { startX, startY, endX, endY, shiftKey } = preview;
  let x = Math.min(startX, endX);
  let y = Math.min(startY, endY);
  let w = Math.abs(endX - startX);
  let h = Math.abs(endY - startY);

  if (shiftKey) {
    const side = Math.max(w, h);
    // Anchor at start point.
    x = startX < endX ? x : startX - side;
    y = startY < endY ? y : startY - side;
    w = side;
    h = side;
  }

  return (
    <div
      data-testid="shape-preview"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        border: '2px dashed #666',
        background: 'rgba(187,222,251,0.2)',
        pointerEvents: 'none',
        zIndex: 100,
      }}
    />
  );
}
