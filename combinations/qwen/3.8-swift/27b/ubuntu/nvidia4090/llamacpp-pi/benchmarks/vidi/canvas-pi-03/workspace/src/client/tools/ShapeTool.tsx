/**
 * Story 10: the Shape tool (shape.ui — the gesture half).
 *
 * A full-viewport layer (above the world, below the UI chrome) that CAPTURES
 * every pointer, so a drag starting over an existing object creates a shape
 * and never moves that object (TC-28).
 *
 * - drag: a dashed screen-space preview follows the pointer (Shift squares
 *   it, using the larger dimension anchored at the drag origin);
 * - release: one `createShape` in world units (rect null for a click / tiny
 *   drag — the model then makes a SHAPE_DEFAULT_SIZE_WORLD square centred on
 *   the point), inside an undo boundary, then `onCreated(id)` selects the
 *   shape and returns to Select (tools.return_to_select);
 * - pointercancel creates nothing.
 */
import { useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { normalizeRect } from 'src/shared/geometry';
import { createShape, type ShapeKind } from 'src/shared/objects/shape';
import type { UndoController } from '../board/undo';

export interface ShapeToolProps {
  kind: ShapeKind;
  camera: Camera;
  doc: Y.Doc;
  /** The board's identity id (createdBy). */
  identity: string;
  /** Story 8: the board's per-user undo controller. */
  undo: UndoController;
  onCreated(id: string): void;
}

interface DragState {
  startClient: Point;
  current: Point;
  shift: boolean;
}

export function ShapeTool(props: ShapeToolProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    const ox = rect ? rect.left : 0;
    const oy = rect ? rect.top : 0;
    return { x: e.clientX - ox, y: e.clientY - oy };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    layerRef.current?.setPointerCapture(e.pointerId);
    setDrag({ startClient: toLocal(e), current: toLocal(e), shift: e.shiftKey });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    setDrag({ ...drag, current: toLocal(e), shift: e.shiftKey });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (layerRef.current) layerRef.current.releasePointerCapture(e.pointerId);
    const startLocal = drag.startClient;
    const endLocal = toLocal(e);
    // The key state AT RELEASE decides (a user may press Shift mid-drag
    // without a further pointermove).
    const shift = e.shiftKey;
    setDrag(null);

    const startWorld = screenToWorld(props.camera, startLocal);
    const endWorld = screenToWorld(props.camera, endLocal);
    const rect = normalizeRect(startWorld, endWorld);
    // Story 8: one shape creation is exactly one undo step.
    props.undo.boundary();
    const id = createShape(
      props.doc,
      { kind: props.kind, rect, at: startWorld, square: shift },
      props.identity,
    );
    props.undo.boundary();
    if (id) props.onCreated(id);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (layerRef.current && layerRef.current.hasPointerCapture(e.pointerId)) {
      layerRef.current.releasePointerCapture(e.pointerId);
    }
    setDrag(null);
  };

  // Screen-space preview rect (dashed).
  let preview: { x: number; y: number; width: number; height: number } | null = null;
  if (drag) {
    const x = Math.min(drag.startClient.x, drag.current.x);
    const y = Math.min(drag.startClient.y, drag.current.y);
    if (drag.shift) {
      const side = Math.max(Math.abs(drag.current.x - drag.startClient.x), Math.abs(drag.current.y - drag.startClient.y));
      preview = { x: drag.startClient.x, y: drag.startClient.y, width: side, height: side };
      // The square is anchored at the drag origin (the model anchors the
      // WORLD square there; mirror it on screen for the preview).
      if (drag.current.x < drag.startClient.x) preview.x = drag.startClient.x - side;
      if (drag.current.y < drag.startClient.y) preview.y = drag.startClient.y - side;
    } else {
      preview = { x, y, width: Math.abs(drag.current.x - drag.startClient.x), height: Math.abs(drag.current.y - drag.startClient.y) };
    }
  }

  return (
    <div
      ref={layerRef}
      data-testid="shape-tool-layer"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <div
          data-testid="shape-preview"
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: preview.x,
            top: preview.y,
            width: preview.width,
            height: preview.height,
            border: '2px dashed #1A73E8',
            backgroundColor: 'rgba(26,115,232,0.08)',
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
