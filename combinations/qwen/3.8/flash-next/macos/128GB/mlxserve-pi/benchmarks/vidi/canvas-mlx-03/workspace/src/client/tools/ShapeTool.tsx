// The Shape tool (story 10 `shape.ui`).
//
// Drag the board and a shape grows under the pointer; a click (or a drag too small
// to be a shape) drops one of the standard size centred on the point; Shift squares
// the drag as it grows. A dashed preview is drawn in *screen* space from the very box
// the model is about to create — `shapeRect` is asked for it, so what is previewed
// and what lands can never disagree.
//
// The tool listens on the viewport in the *capture* phase and stops the event there:
// that is what makes a drag that starts on top of an existing object belong to the
// tool instead of moving that object (TC-28), exactly as story 9's Text tool places a
// text on top of a note without selecting it. The moves and the release are tracked on
// `window`, so a gesture that leaves the board still finishes.
//
// One gesture creates at most one shape: `createShape` is called once on release, the
// undo step is closed there, and `onCreated` selects the new shape and hands the board
// back to Select (tools.return_to_select). A cancelled pointer creates nothing.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera.ts';
import { normalizeRect, type Rect } from '../../shared/geometry.ts';
import { createShape, shapeRect } from '../../shared/objects/shape.ts';
import type { ShapeKind } from '../../shared/config.ts';
import { useUndoBoundary } from '../board/useUndo.ts';

export interface ShapeToolProps {
  /** The kind the next shape is drawn as (the Shape menu's choice). */
  kind: ShapeKind;
  doc: Y.Doc;
  /** The id this client is credited with (`createdBy`). */
  by: string;
  camera: Camera;
  /** The board surface the tool takes over while it is armed. */
  viewportRef: RefObject<HTMLElement | null>;
  /** False while the board is locked: the tool then takes nothing. */
  canEdit?: boolean;
  /** A shape was created: select it and return to Select. */
  onCreated(id: string): void;
}

/** The dashed preview box, in page (screen) coordinates. */
interface Preview {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The armed Shape tool: it renders only the screen-space preview and owns the pointer
 * gesture over the board.
 */
export function ShapeTool(props: ShapeToolProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const kindRef = useRef(props.kind);
  kindRef.current = props.kind;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const byRef = useRef(props.by);
  byRef.current = props.by;
  const canEditRef = useRef(props.canEdit ?? true);
  canEditRef.current = props.canEdit ?? true;
  const createdRef = useRef(props.onCreated);
  createdRef.current = props.onCreated;
  const boundary = useUndoBoundary();

  // The gesture: where the drag started (world), whether Shift was held on the last
  // move, and the pointer id it belongs to.
  const dragRef = useRef<{ at: Point; square: boolean; id: number } | null>(null);

  // The world point of a pointer event, and the box it would create — the model's own
  // rule, so the preview is the outcome.
  const worldOf = (e: { clientX: number; clientY: number }): Point => {
    const el = props.viewportRef.current;
    const r = el ? el.getBoundingClientRect() : null;
    const p = {
      x: e.clientX - (r?.left ?? 0),
      y: e.clientY - (r?.top ?? 0),
    };
    return screenToWorld(cameraRef.current, p);
  };

  const boxOf = (at: Point, to: Point, square: boolean): Rect | null =>
    shapeRect({ rect: normalizeRect(at, to), at, square });

  // Screen box of a world rect, in the page coordinates the fixed overlay draws in.
  const screenOf = (box: Rect): Preview => {
    const el = props.viewportRef.current;
    const r = el ? el.getBoundingClientRect() : null;
    const cam = cameraRef.current;
    const a = worldToScreen(cam, { x: box.x, y: box.y });
    const b = worldToScreen(cam, { x: box.x + box.width, y: box.y + box.height });
    return {
      x: (r?.left ?? 0) + a.x,
      y: (r?.top ?? 0) + a.y,
      width: Math.max(0, b.x - a.x),
      height: Math.max(0, b.y - a.y),
    };
  };

  useEffect(() => {
    const el = props.viewportRef.current;
    if (!el) return;

    const onDown = (e: PointerEvent) => {
      if (!canEditRef.current) return;
      // The tool owns this pointer: no pan, no marquee, no drag of the object under
      // the pointer, no clear-selection (all of which start from the same event).
      e.preventDefault();
      e.stopPropagation();
      const at = worldOf(e);
      dragRef.current = { at, square: e.shiftKey, id: e.pointerId };
      setPreview(screenOf(boxOf(at, at, e.shiftKey) ?? { x: at.x, y: at.y, width: 0, height: 0 }));
    };

    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      drag.square = e.shiftKey; // Shift is re-read on every move (shape.constrain)
      const box = boxOf(drag.at, worldOf(e), e.shiftKey);
      if (box) setPreview(screenOf(box));
    };

    const finish = (e: PointerEvent, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setPreview(null);
      if (cancelled) return; // a pointer that never landed draws nothing
      const rect = normalizeRect(drag.at, worldOf(e));
      boundary();
      const id = createShape(docRef.current, { kind: kindRef.current, rect, at: drag.at, square: drag.square }, byRef.current);
      boundary();
      if (id) createdRef.current(id);
    };

    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);

    el.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      el.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // The gesture reads everything mutable through refs, so it is bound once per
    // viewport element; re-binding it mid-drag would drop the listener under the
    // pointer that is already down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.viewportRef]);

  if (!preview) return null;
  return (
    <svg
      data-testid="shape-tool-overlay"
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 26,
      }}
    >
      <rect
        data-testid="shape-preview"
        x={preview.x}
        y={preview.y}
        width={preview.width}
        height={preview.height}
        fill="rgba(47,111,237,0.08)"
        stroke="#2f6fed"
        strokeWidth={1}
        strokeDasharray="6 4"
      />
    </svg>
  );
}

export default ShapeTool;
