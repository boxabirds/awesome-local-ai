import { useCallback, useRef, useState, type JSX } from 'react';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import { createShape, type ShapeKind } from '../../shared/objects/shape';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type * as Y from 'yjs';
import type { UndoController } from '../board/undo';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  createdBy: string;
  onCreated(id: string): void;
  undo?: UndoController;
}

/**
 * Shape creation tool (shape.ui). Captures the pointer so drags starting over
 * existing objects never move them. Draws a dashed preview during the drag.
 * On release, calls createShape once (rect null for clicks/tiny drags), then
 * stopCapturing and onCreated.
 */
export function ShapeTool(props: ShapeToolProps): JSX.Element | null {
  const { kind, camera, doc, createdBy, onCreated, undo } = props;
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);
  const [square, setSquare] = useState(false);
  const startRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);
  const squareRef = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = { x: e.clientX, y: e.clientY };
    startRef.current = p;
    currentRef.current = p;
    squareRef.current = e.shiftKey;
    setStart(p);
    setCurrent(p);
    setSquare(e.shiftKey);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current) return;
    const p = { x: e.clientX, y: e.clientY };
    currentRef.current = p;
    squareRef.current = e.shiftKey;
    setCurrent(p);
    setSquare(e.shiftKey);
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!startRef.current) return;
    const end = { x: e.clientX, y: e.clientY };
    const s = startRef.current;
    startRef.current = null;
    currentRef.current = null;
    setStart(null);
    setCurrent(null);

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }

    // Convert to world coordinates
    const worldStart = screenToWorld(camera, s);
    const worldEnd = screenToWorld(camera, end);

    // Compute the rect in world space
    const rx = Math.min(worldStart.x, worldEnd.x);
    const ry = Math.min(worldStart.y, worldEnd.y);
    const rw = Math.abs(worldEnd.x - worldStart.x);
    const rh = Math.abs(worldEnd.y - worldStart.y);

    // Determine if this is a "click" (tiny drag)
    const isClick = rw < SHAPE_MIN_SIZE_WORLD || rh < SHAPE_MIN_SIZE_WORLD;
    const rect = isClick ? null : { x: rx, y: ry, width: rw, height: rh };

    undo?.boundary();
    const id = createShape(doc, {
      kind,
      rect,
      at: worldStart,
      square: squareRef.current || undefined,
    }, createdBy);

    if (id) {
      undo?.boundary();
      onCreated(id);
    }
  }, [camera, doc, kind, createdBy, onCreated, undo]);

  const handlePointerCancel = useCallback(() => {
    startRef.current = null;
    currentRef.current = null;
    setStart(null);
    setCurrent(null);
  }, []);

  // Compute the preview rect in screen space
  let preview: { x: number; y: number; width: number; height: number } | null = null;
  if (start && current) {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    let w = Math.abs(current.x - start.x);
    let h = Math.abs(current.y - start.y);
    if (square) {
      const s = Math.max(w, h);
      w = s;
      h = s;
      // Anchor at start
      preview = {
        x: current.x > start.x ? start.x : start.x - s,
        y: current.y > start.y ? start.y : start.y - s,
        width: s,
        height: s,
      };
    } else {
      preview = { x, y, width: w, height: h };
    }
  }

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        touchAction: 'none',
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
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
            border: '2px dashed #1A73E8',
            background: 'rgba(26, 115, 232, 0.05)',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
