// Shape drawing tool (see spec: shape.ui): a full-viewport overlay active
// while tool === 'shape'. Drag draws a dashed screen-space preview (Shift
// forces a square/circle, read on every move); a click or tiny drag creates
// the standard-size shape centred on the point (shape.create_click).
// `createShape` is called once on pointerup; pointercancel creates nothing.
// The overlay captures the pointer so a drag starting over an existing
// object never moves it (TC-28).

import { useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { createShape, type ShapeKind } from '../../shared/objects/shape';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { UndoController } from '../board/undo';
import { SHAPE_MIN_SIZE_WORLD } from '../../shared/config';
import type { Point, Rect } from '../../shared/geometry';

export interface ShapeToolProps {
  /** The kind the tool draws (from useActiveTool's Shape menu). */
  kind: ShapeKind;
  /** The live Y.Doc. */
  doc: Y.Doc;
  /** Current camera (screen ↔ world conversion for the preview). */
  camera: Camera;
  /** This tab's undo controller (stopCapturing after creation). */
  undo?: UndoController | null;
  /** The creator identity (per-tab Yjs client id). */
  by: string;
  /** A shape was created: select it and return to Select (BoardPage). */
  onCreated(id: string): void;
}

/** Normalise a start→end drag into a rect (positive width/height). */
function dragRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Shift: the larger dragged dimension as a square anchored at the origin. */
function squareRect(rect: Rect): Rect {
  const side = Math.max(rect.width, rect.height);
  return { x: rect.x, y: rect.y, width: side, height: side };
}

function isTiny(rect: Rect): boolean {
  return rect.width < SHAPE_MIN_SIZE_WORLD || rect.height < SHAPE_MIN_SIZE_WORLD;
}

export function ShapeTool({ kind, doc, camera, undo, by, onCreated }: ShapeToolProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<Point | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  const toWorld = (event: { clientX: number; clientY: number }): Point => {
    const el = overlayRef.current;
    if (el === null) return screenToWorld(camera, { x: event.clientX, y: event.clientY });
    const rect = el.getBoundingClientRect();
    return screenToWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = overlayRef.current;
    if (el === null) return;
    try {
      el.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture unsupported (e.g. jsdom) — drag still works.
    }
    startRef.current = toWorld(event);
    setDraft(dragRect(startRef.current, startRef.current));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (startRef.current === null) return;
    const rect = dragRect(startRef.current, toWorld(event));
    setDraft(event.shiftKey ? squareRect(rect) : rect);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    startRef.current = null;
    if (start === null) return;
    setDraft(null);
    const end = toWorld(event);
    const rect = dragRect(start, end);
    const id = createShape(
      doc,
      {
        kind,
        // rect null for a click / tiny drag → standard size centred at `at`.
        rect: isTiny(rect) ? null : rect,
        at: end,
        square: event.shiftKey,
      },
      by,
    );
    if (id !== null) {
      undo?.boundary();
      onCreated(id);
    }
    // A rejected creation (should not happen here) leaves the tool active.
  };

  const onPointerCancel = (): void => {
    startRef.current = null;
    setDraft(null);
  };

  // Screen-space dashed preview of the current draft rect.
  let preview = null;
  if (draft !== null && (draft.width > 0 || draft.height > 0)) {
    const a = worldToScreen(camera, { x: draft.x, y: draft.y });
    const b = worldToScreen(camera, { x: draft.x + draft.width, y: draft.y + draft.height });
    preview = (
      <div
        data-testid="shape-draft"
        className="shape-draft"
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: Math.min(a.x, b.x),
          top: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
        }}
      />
    );
  }

  return (
    <div
      ref={overlayRef}
      data-testid="shape-tool"
      className="shape-tool"
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 5 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {preview}
    </div>
  );
}
