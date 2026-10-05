/**
 * The Shape tool (story 10, `shape.create`).
 *
 * A screen-space layer over the board that owns the pointer while it is up: a press
 * starts a box, the drag sizes it, the release makes one shape. Because the layer sits
 * above the objects, a press that begins *on* a shape draws a shape instead of moving
 * the shape underneath — a tool's gesture belongs to the tool (`tools.own_gesture`).
 *
 * The preview is drawn in screen pixels from the two corners of the drag, and the
 * world rectangle handed to the model comes from the same two corners, so what was
 * drawn is what is made. A press that never travelled `DRAG_THRESHOLD_PX` is a click:
 * no rectangle is passed at all, and the model decides the size of a clicked shape and
 * where Shift's square is anchored (`shapeBox`).
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, type ShapeKind } from '../../shared/config';
import { createShape } from '../../shared/objects/shape';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';

export interface ShapeToolProps {
  doc: Y.Doc;
  /** Which of the three drawings this press will make. */
  kind: ShapeKind;
  camera: Camera;
  /** Written into the shape as `createdBy`. */
  by?: string;
  /** The shape landed: select it and put the tool back to Select. */
  onCreated(id: string): void;
  /** Open and close one undo step around the creation. */
  onUndoBoundary?(): void;
}

/** A drag in screen pixels, relative to this layer. */
interface Draft {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  square: boolean;
}

export function ShapeTool(props: ShapeToolProps) {
  const { doc, kind, camera, by = 'local', onCreated, onUndoBoundary } = props;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const live = useRef({ doc, kind, camera, by, onCreated, onUndoBoundary });
  live.current = { doc, kind, camera, by, onCreated, onUndoBoundary };

  // The gesture's own listeners, so that unmounting in the middle of a drag (Escape
  // puts the tool down) takes the gesture with it instead of leaving a window listener
  // that would still create a shape on the next release.
  const gestureStop = useRef<(() => void) | null>(null);
  useEffect(() => () => gestureStop.current?.(), []);

  /** Client pixels to a point inside this layer, which covers the board exactly. */
  const localOf = useCallback((clientX: number, clientY: number): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      // Only a plain left press draws. Anything with a modifier belongs to the
      // viewport (pan, marquee) or to the browser, not to this tool.
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      event.stopPropagation();
      const start = localOf(event.clientX, event.clientY);
      const move = (e: PointerEvent): void => {
        const here = localOf(e.clientX, e.clientY);
        // Shift is read on every move: holding it late still squares the box, and
        // letting go still stops squaring — the preview says so as it happens.
        setDraft({ x0: start.x, y0: start.y, x1: here.x, y1: here.y, square: e.shiftKey });
      };
      const up = (e: PointerEvent): void => {
        gestureStop.current?.();
        setDraft(null);
        const here = live.current;
        const end = localOf(e.clientX, e.clientY);
        const a = screenToWorld(here.camera, start);
        const b = screenToWorld(here.camera, end);
        const travelled = Math.hypot(end.x - start.x, end.y - start.y);
        const dragged = {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: Math.abs(b.x - a.x),
          height: Math.abs(b.y - a.y),
        };
        const rect = travelled < DRAG_THRESHOLD_PX ? null : dragged;
        // One shape is one undo step, whatever the drag looked like.
        here.onUndoBoundary?.();
        const id = createShape(here.doc, { kind: here.kind, rect, at: a, square: e.shiftKey }, here.by);
        here.onUndoBoundary?.();
        if (id) here.onCreated(id);
      };
      // A cancelled gesture (a second pointer, a system interruption) makes nothing.
      const cancel = (): void => {
        gestureStop.current?.();
        setDraft(null);
      };
      gestureStop.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      };
      setDraft({ x0: start.x, y0: start.y, x1: start.x, y1: start.y, square: event.shiftKey });
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    },
    [localOf],
  );

  return (
    <div
      ref={layerRef}
      className="shape-tool-layer"
      data-tool-layer="shape"
      data-shape-kind={kind}
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'crosshair',
        // Above the objects (the world layer has no z-index), below the selection bar
        // (6), the marquee (5), the toolbar and the zoom controls (10).
        zIndex: 4,
      }}
      onPointerDown={onPointerDown}
    >
      {draft ? <ShapePreview draft={draft} kind={kind} /> : null}
    </div>
  );
}

/**
 * The dashed outline while the button is down. Shift's square is anchored at the
 * corner the drag started from, so it grows the way the drag is going — the same rule
 * the model applies when it makes the shape.
 */
export function ShapePreview(props: { draft: Draft; kind: ShapeKind }) {
  const { draft, kind } = props;
  const raw = {
    left: Math.min(draft.x0, draft.x1),
    top: Math.min(draft.y0, draft.y1),
    width: Math.abs(draft.x1 - draft.x0),
    height: Math.abs(draft.y1 - draft.y0),
  };
  let box = raw;
  if (draft.square) {
    const side = Math.max(raw.width, raw.height);
    box = {
      left: draft.x1 < draft.x0 ? draft.x0 - side : draft.x0,
      top: draft.y1 < draft.y0 ? draft.y0 - side : draft.y0,
      width: side,
      height: side,
    };
  }
  return (
    <div
      data-testid="shape-preview"
      data-shape-kind={kind}
      style={{
        position: 'absolute',
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        border: '2px dashed #1e88e5',
        background: 'rgba(30, 136, 229, 0.08)',
        borderRadius: kind === 'ellipse' ? '50%' : 0,
        // The preview is a hint, not a target: the layer keeps the gesture.
        pointerEvents: 'none',
      }}
    />
  );
}
