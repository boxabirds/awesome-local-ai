import { useRef, useEffect, useReducer, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { ShapeKind } from '../../shared/objects/shape';
import { createShape } from '../../shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type * as Y from 'yjs';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  createdBy: string;
  onCreated(id: string): void;
  onGestureEnd(): void;
}

/**
 * Shape tool: drag to create a shape, or click to drop a standard-size shape.
 * Captures the pointer so drags starting over existing objects never move them.
 * Shift constrains to square.
 */
export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const { kind, camera, doc, createdBy, onCreated, onGestureEnd } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const shiftRef = useRef(false);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const pd = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-testid="toolbar"]')) return;
      if (target.closest('[data-testid="selection-bar"]')) return;
      if (target.closest('[data-testid="shape-toolbar"]')) return;

      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      dragStartRef.current = sp;
      dragCurrentRef.current = sp;
      shiftRef.current = e.shiftKey;
      forceRender();
    };

    const pm = (e: PointerEvent) => {
      if (!dragStartRef.current) return;
      const rect = el.getBoundingClientRect();
      dragCurrentRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      shiftRef.current = e.shiftKey;
      forceRender();
    };

    const pu = (e: PointerEvent) => {
      if (!dragStartRef.current) return;
      try { el.releasePointerCapture(e.pointerId); } catch {}
      const rect = el.getBoundingClientRect();
      const endPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const startPoint = dragStartRef.current;

      const worldStart = screenToWorld(camera, startPoint);
      const worldEnd = screenToWorld(camera, endPoint);

      const dragW = Math.abs(worldEnd.x - worldStart.x);
      const dragH = Math.abs(worldEnd.y - worldStart.y);

      let r: { x: number; y: number; width: number; height: number } | null;
      if (dragW < SHAPE_MIN_SIZE_WORLD && dragH < SHAPE_MIN_SIZE_WORLD) {
        r = null;
      } else {
        r = {
          x: Math.min(worldStart.x, worldEnd.x),
          y: Math.min(worldStart.y, worldEnd.y),
          width: dragW,
          height: dragH,
        };
      }

      const id = createShape(doc, { kind, rect: r, at: worldStart, square: shiftRef.current }, createdBy);
      dragStartRef.current = null;
      dragCurrentRef.current = null;
      forceRender();

      if (id) {
        onGestureEnd();
        onCreated(id);
      }
    };

    const pc = () => {
      dragStartRef.current = null;
      dragCurrentRef.current = null;
      forceRender();
    };

    el.addEventListener('pointerdown', pd, { capture: true });
    el.addEventListener('pointermove', pm);
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pc);
    return () => {
      el.removeEventListener('pointerdown', pd, { capture: true });
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pc);
    };
  }, [camera, doc, kind, createdBy, onCreated, onGestureEnd]);

  // Render preview
  const start = dragStartRef.current;
  const current = dragCurrentRef.current;

  let preview: { x: number; y: number; w: number; h: number } | null = null;
  if (start && current) {
    const sw = Math.abs(current.x - start.x);
    const sh = Math.abs(current.y - start.y);

    if (shiftRef.current) {
      const size = Math.max(sw, sh);
      preview = {
        x: current.x >= start.x ? start.x : start.x - size,
        y: current.y >= start.y ? start.y : start.y - size,
        w: size,
        h: size,
      };
    } else {
      preview = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: sw,
        h: sh,
      };
    }
  }

  return (
    <div
      ref={containerRef}
      data-testid="shape-tool-overlay"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 50,
        cursor: 'crosshair',
      }}
    >
      {preview && preview.w > 2 && preview.h > 2 && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'absolute',
            left: preview.x,
            top: preview.y,
            width: preview.w,
            height: preview.h,
            border: '2px dashed #2196F3',
            backgroundColor: 'rgba(33, 150, 243, 0.1)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
