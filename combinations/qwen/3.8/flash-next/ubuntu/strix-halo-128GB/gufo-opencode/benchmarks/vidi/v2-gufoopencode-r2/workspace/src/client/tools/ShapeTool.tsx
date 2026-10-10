// Shape tool (Shape button or S): drag draws a rectangle/ellipse/diamond
// covering the dragged area (Shift constrains to a square); a plain click drops
// a standard-size SHAPE_DEFAULT_SIZE_WORLD shape centred on the click. The
// dashed preview lives in screen space; creation happens once on pointerup
// through createShape, then the new shape is selected and the tool returns to
// Select. The catcher covers the board, so drags starting over existing objects
// size the shape instead of moving them.

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ShapeKind } from '../../shared/config';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../shared/config';
import type { UndoController } from '../board/undo';
import { createShape } from '../../shared/objects/shape';
import { screenToWorld, type Camera } from '../canvas/camera';

// Movement below this many screen pixels counts as a click, not a drag.
const CLICK_THRESHOLD_PX = 3;

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  by: string;
  undo?: UndoController;
  onCreated(id: string): void;
}

interface DragPreview {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function ShapeTool({ kind, camera, doc, by, undo, onCreated }: ShapeToolProps): React.JSX.Element {
  const catcherRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = catcherRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      let square = e.shiftKey;
      let current = { x0: sx, y0: sy, x1: sx, y1: sy };
      setPreview({ ...current });
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // jsdom: no pointer capture; window listeners below still drive it.
      }

      const onMove = (ev: PointerEvent): void => {
        square = ev.shiftKey;
        current = { x0: sx, y0: sy, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top };
        setPreview({ ...current });
      };
      const onUp = (ev: PointerEvent): void => {
        cleanupRef.current?.();
        cleanupRef.current = null;
        setPreview(null);
        const endX = ev.clientX - rect.left;
        const endY = ev.clientY - rect.top;
        const start = screenToWorld(camera, { x: sx, y: sy });
        if (Math.hypot(endX - sx, endY - sy) < CLICK_THRESHOLD_PX) {
          undo?.boundary();
          const id = createShape(doc, { kind, rect: null, at: start }, by);
          undo?.boundary();
          if (id) onCreated(id);
          return;
        }
        const end = screenToWorld(camera, { x: endX, y: endY });
        let x = Math.min(start.x, end.x);
        let y = Math.min(start.y, end.y);
        let width = Math.abs(end.x - start.x);
        let height = Math.abs(end.y - start.y);
        if (square) {
          const side = Math.max(width, height);
          // Grow from the anchor corner in the dragged direction.
          const dirX = end.x >= start.x ? 1 : -1;
          const dirY = end.y >= start.y ? 1 : -1;
          x = dirX > 0 ? x : start.x - side;
          y = dirY > 0 ? y : start.y - side;
          width = side;
          height = side;
        }
        undo?.boundary();
        const id = createShape(doc, { kind, rect: { x, y, width, height }, at: start }, by);
        undo?.boundary();
        if (id) onCreated(id);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      cleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
    },
    [by, camera, doc, kind, onCreated, undo],
  );

  // Unmounting (Escape switches to Select, load failure) cancels an unfinished
  // drag: no creation, no leftover listeners (tools.return_to_select).
  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      setPreview(null);
    },
    [],
  );

  let previewShape: React.JSX.Element | null = null;
  if (preview) {
    const x = Math.min(preview.x0, preview.x1);
    const y = Math.min(preview.y0, preview.y1);
    const w = Math.abs(preview.x1 - preview.x0);
    const h = Math.abs(preview.y1 - preview.y0);
    const z = camera.zoom || 1;
    if (w < CLICK_THRESHOLD_PX && h < CLICK_THRESHOLD_PX) {
      // Click preview: show the standard-size footprint centred on the click.
      const d = SHAPE_DEFAULT_SIZE_WORLD * z;
      previewShape = (
        <svg
          data-testid="shape-preview"
          className="shape-preview"
          style={{ left: preview.x0 - d / 2, top: preview.y0 - d / 2, width: d, height: d }}
        >
          <rect x={0.5} y={0.5} width={d - 1} height={d - 1} />
        </svg>
      );
    } else {
      previewShape = (
        <svg
          data-testid="shape-preview"
          className="shape-preview"
          style={{ left: x, top: y, width: w, height: h }}
        >
          {kind === 'ellipse' ? (
            <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 0.5} ry={h / 2 - 0.5} />
          ) : kind === 'diamond' ? (
            <polygon points={`${w / 2},0.5 ${w - 0.5},${h / 2} ${w / 2},${h - 0.5} 0.5,${h / 2}`} />
          ) : (
            <rect x={0.5} y={0.5} width={Math.max(0, w - 1)} height={Math.max(0, h - 1)} />
          )}
        </svg>
      );
    }
  }

  return (
    <div
      ref={catcherRef}
      data-testid="shape-tool-catcher"
      className="tool-catcher"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5 }}
      onPointerDown={onPointerDown}
    >
      {previewShape}
    </div>
  );
}
