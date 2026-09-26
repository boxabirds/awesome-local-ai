import { useState, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import * as Y from 'yjs';
import type { Point, Rect } from '@/shared/geometry';
import { SHAPE_DEFAULT_SIZE_WORLD } from '@/shared/config';
import { createShape, type ShapeKind } from '@/shared/objects/shape';
import { screenToWorld, type Camera } from '../canvas/camera';
import { shapeElement } from '../objects/ShapeObject';

/**
 * The Shape tool (story 10, shape.tool): a full-screen overlay above the
 * viewport. Pressing starts the drag; a dashed preview (the kind's outline)
 * follows the pointer; releasing creates the shape with `createShape` and
 * the Board selects it and returns to Select (shape.tool / text.create).
 *
 * - A press without a meaningful drag (rect null or below the model's min
 *   size) creates the default SHAPE_DEFAULT_SIZE_WORLD square centred on the
 *   press point (shape.create_click).
 * - Shift held constrains to a square (shape.constrain).
 *
 * The overlay captures pointer events (the viewport underneath neither pans
 * nor selects while the tool is active).
 */

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  /** The per-tab creator id (persisted as `createdBy`). */
  createdBy: string;
  /** Called with the new object's id on a successful creation. */
  onCreated(id: string): void;
  /** Story 8: close the undo capture window around the creation. */
  onBoundary?(): void;
}

/** Normalized drag rect (top-left + positive size); null for a plain click. */
function dragRect(start: Point, end: Point, square: boolean): Rect | null {
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (w < 1 && h < 1) return null;
  let width = w;
  let height = h;
  if (square) {
    const s = Math.max(w, h);
    width = s;
    height = s;
  }
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width,
    height,
  };
}

const PREVIEW_COLOR = '#1A73E8';

export function ShapeTool(props: ShapeToolProps): ReactElement {
  const { kind, camera, doc, onCreated } = props;
  const [drag, setDrag] = useState<{ start: Point; end: Point; square: boolean } | null>(null);

  const toWorld = (e: ReactPointerEvent): Point =>
    screenToWorld(camera, { x: e.clientX, y: e.clientY });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = toWorld(e);
    setDrag({ start: p, end: p, square: e.shiftKey });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    setDrag({ ...drag, end: toWorld(e), square: e.shiftKey });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    const end = toWorld(e);
    const start = drag.start;
    const square = e.shiftKey;
    setDrag(null);
    const rect = dragRect(start, end, square);
    props.onBoundary?.();
    const id = createShape(doc, { kind, rect, at: start, square }, props.createdBy);
    props.onBoundary?.();
    if (id !== null) onCreated(id);
  };

  // Preview: the current drag rect in screen space (dashed kind outline).
  const previewRect = drag !== null ? dragRect(drag.start, drag.end, drag.square) : null;
  const preview =
    previewRect !== null
      ? previewRect
      : drag !== null
        ? {
            x: drag.start.x - SHAPE_DEFAULT_SIZE_WORLD / 2,
            y: drag.start.y - SHAPE_DEFAULT_SIZE_WORLD / 2,
            width: SHAPE_DEFAULT_SIZE_WORLD,
            height: SHAPE_DEFAULT_SIZE_WORLD,
          }
        : null;
  const previewScale = camera.zoom;

  return (
    <div
      data-testid="shape-tool-overlay"
      style={{ position: 'fixed', inset: 0, zIndex: 5, cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {preview !== null && (
        <div
          data-testid="shape-preview"
          style={{
            position: 'absolute',
            left: (preview.x - camera.x) * previewScale,
            top: (preview.y - camera.y) * previewScale,
            width: preview.width * previewScale,
            height: preview.height * previewScale,
            pointerEvents: 'none',
          }}
        >
          <svg
            width={preview.width * previewScale}
            height={preview.height * previewScale}
            style={{ display: 'block', overflow: 'visible' }}
          >
            {shapeElement(
              kind,
              preview.width * previewScale,
              preview.height * previewScale,
              'rgba(26, 115, 232, 0.08)',
              PREVIEW_COLOR,
              1.5,
              true,
            )}
          </svg>
        </div>
      )}
    </div>
  );
}
