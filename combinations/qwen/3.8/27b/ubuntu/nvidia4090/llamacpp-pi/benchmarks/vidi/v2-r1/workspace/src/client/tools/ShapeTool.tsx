// ShapeTool (story 10, shape.ui): the Shape tool's pointer gesture.
//
//  - A press inside the viewport starts the drag (capture phase, so a press
//    that begins over an existing object never moves that object — TC-28);
//    the pointer is captured so the drag finishes no matter where it ends.
//  - A dashed screen-space preview follows the pointer (Shift constrains to
//    a square live, shape.constrain).
//  - pointerup calls createShape once (undo boundaries around it) and
//    onCreated(id), which selects the new shape and switches back to Select
//    (tools.return_to_select). Model rejections leave the tool active and
//    create nothing.
//  - Unmounting (Escape or any other tool switch) drops an unfinished drag
//    without creating anything.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  SHAPE_DEFAULT_SIZE_WORLD,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLOR_PREVIEW,
  type ShapeKind,
} from '../../shared/config';
import { shapeRect } from '../../shared/objects/shape';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { getClientId } from '../client-id';
import type { UndoController } from '../board/undo';
import { createShape } from '../../shared/objects/shape';
import type { Rect } from '../../shared/geometry';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  canEdit: boolean;
  undo?: UndoController;
  onCreated(id: string): void;
}

interface DragState {
  start: Point;
  current: Point;
  shift: boolean;
}

function viewportBounds(): { left: number; top: number } {
  const v = document.querySelector('[data-testid="board-viewport"]');
  const r = v ? v.getBoundingClientRect() : null;
  return r ? { left: r.left, top: r.top } : { left: 0, top: 0 };
}

export function ShapeTool(props: ShapeToolProps): JSX.Element | null {
  const { kind, camera, doc, canEdit, undo, onCreated } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const stateRef = useRef({ camera, doc, canEdit, undo, onCreated, kind });
  stateRef.current = { camera, doc, canEdit, undo, onCreated, kind };

  useEffect(() => {
    const toWorld = (clientX: number, clientY: number): Point => {
      const b = viewportBounds();
      return screenToWorld(stateRef.current.camera, {
        x: clientX - b.left,
        y: clientY - b.top,
      });
    };
    const inViewport = (t: EventTarget | null): boolean =>
      t instanceof Element && t.closest('[data-testid="board-viewport"]') !== null;

    const onPointerDown = (e: PointerEvent): void => {
      const s = stateRef.current;
      if (!s.canEdit) return;
      if (!inViewport(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof Element && typeof e.target.setPointerCapture === 'function') {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {
          // Ignore: best-effort (jsdom).
        }
      }
      const p = toWorld(e.clientX, e.clientY);
      dragRef.current = { start: p, current: p, shift: e.shiftKey };
      setDrag(dragRef.current);
    };
    const onPointerMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      const p = toWorld(e.clientX, e.clientY);
      dragRef.current = { ...d, current: p, shift: e.shiftKey };
      setDrag(dragRef.current);
    };
    const onPointerUp = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      dragRef.current = null;
      setDrag(null);
      const s = stateRef.current;
      const p = toWorld(e.clientX, e.clientY);
      const rect: Rect = {
        x: Math.min(d.start.x, p.x),
        y: Math.min(d.start.y, p.y),
        width: Math.abs(p.x - d.start.x),
        height: Math.abs(p.y - d.start.y),
      };
      // One creation is one undo step, separate from everything around it.
      s.undo?.boundary();
      const id = createShape(
        s.doc,
        { kind: s.kind, rect, at: d.start, square: d.shift },
        getClientId(),
      );
      s.undo?.boundary();
      if (id !== null) s.onCreated(id);
    };
    const onPointerCancel = (): void => {
      dragRef.current = null;
      setDrag(null);
    };
    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onPointerCancel, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerCancel, { capture: true });
    };
  }, []);

  if (drag === null) return null;

  // The preview shows exactly what pointerup would create.
  const rect: Rect = {
    x: Math.min(drag.start.x, drag.current.x),
    y: Math.min(drag.start.y, drag.current.y),
    width: Math.abs(drag.current.x - drag.start.x),
    height: Math.abs(drag.current.y - drag.start.y),
  };
  const preview =
    rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD
      ? {
          x: drag.start.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
          y: drag.start.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
          width: SHAPE_DEFAULT_SIZE_WORLD,
          height: SHAPE_DEFAULT_SIZE_WORLD,
        }
      : shapeRect(rect, drag.start, drag.shift);
  const a = worldToScreen(camera, { x: preview.x, y: preview.y });
  const b = worldToScreen(camera, {
    x: preview.x + preview.width,
    y: preview.y + preview.height,
  });

  return (
    <div
      className="shape-preview"
      data-testid="shape-preview"
      style={{
        position: 'fixed',
        left: a.x,
        top: a.y,
        width: Math.max(1, b.x - a.x),
        height: Math.max(1, b.y - a.y),
        border: `2px dashed ${SHAPE_STROKE_COLOR_PREVIEW}`,
        background: 'rgba(38, 50, 56, 0.06)',
        pointerEvents: 'none',
        zIndex: 10000,
        boxSizing: 'border-box',
      }}
      aria-hidden="true"
    />
  );
}
