/**
 * Shape tool (story 10, shape.ui).
 *
 * Renders a screen-space overlay that captures pointer events when the Shape
 * tool is active. Handles drag-to-create and click-to-drop with preview.
 * Shift constrains proportions. On creation calls createShape and notifies parent.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import type { ShapeKind } from '../../shared/config';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import { normalizeRect, type Point, type Rect } from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import { createShape } from '../../shared/objects/shape';
import type * as Y from 'yjs';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  canEdit: boolean;
  onCreated(id: string): void;
  /** Get the board element for screen-relative coordinates. */
  getBoardRect(): DOMRect | null;
}

interface DragState {
  start: Point;
  current: Point;
  shift: boolean;
}

export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const { kind, camera, doc, canEdit, onCreated, getBoardRect } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  const toWorld = useCallback((screenPt: Point): Point => {
    return screenToWorld(camera, screenPt);
  }, [camera]);

  const getScreenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const boardRect = getBoardRect();
    if (!boardRect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - boardRect.left, y: e.clientY - boardRect.top };
  }, [getBoardRect]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!canEdit) return;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* best effort */ }
    pointerIdRef.current = e.pointerId;
    const sp = getScreenPoint(e);
    const wp = toWorld(sp);
    setDrag({ start: wp, current: wp, shift: e.shiftKey });
  }, [canEdit, getScreenPoint, toWorld]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const sp = getScreenPoint(e);
    const wp = toWorld(sp);
    setDrag((prev) => prev ? { ...prev, current: wp, shift: e.shiftKey } : prev);
  }, [getScreenPoint, toWorld]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    const el = e.currentTarget as HTMLElement;
    try { el.releasePointerCapture(e.pointerId); } catch { /* best effort */ }

    const sp = getScreenPoint(e);
    const wp = toWorld(sp);

    if (!drag) {
      setDrag(null);
      return;
    }

    // Compute rect from start to current
    const rawRect = normalizeRect(drag.start, wp);

    const rect: Rect | null = (rawRect.width >= SHAPE_MIN_SIZE_WORLD && rawRect.height >= SHAPE_MIN_SIZE_WORLD)
      ? rawRect
      : null;

    const id = createShape(doc, {
      kind,
      rect,
      at: drag.start, // Use the drag start point as the anchor for clicks
      square: drag.shift,
    }, 'user');

    setDrag(null);

    if (id) {
      onCreated(id);
    }
  }, [drag, kind, doc, canEdit, getScreenPoint, toWorld, onCreated]);

  const onPointerCancel = useCallback(() => {
    pointerIdRef.current = null;
    setDrag(null);
  }, []);

  // Render preview rect
  let preview: JSX.Element | null = null;
  if (drag) {
    const tl = normalizeRect(drag.start, drag.current);
    let previewW = tl.width;
    let previewH = tl.height;
    let previewX = tl.x;
    let previewY = tl.y;
    if (drag.shift) {
      const side = Math.max(previewW, previewH);
      previewW = side;
      previewH = side;
    }
    preview = (
      <div
        style={{
          position: 'absolute',
          left: `${previewX}px`,
          top: `${previewY}px`,
          width: `${previewW}px`,
          height: `${previewH}px`,
          border: '2px dashed #4A90D9',
          backgroundColor: 'rgba(74,144,217,0.05)',
          pointerEvents: 'none',
        }}
      />
    );
  }

  return (
    <div
      className="shape-tool-overlay"
      data-testid="shape-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 9999,
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {preview && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          width: 0,
          height: 0,
        }}>
          {preview}
        </div>
      )}
    </div>
  );
}
