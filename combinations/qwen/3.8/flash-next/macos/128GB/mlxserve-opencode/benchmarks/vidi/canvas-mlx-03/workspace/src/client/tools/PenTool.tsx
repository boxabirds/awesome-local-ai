// The Pen tool (story 11 `pen.ui`): draw freehand.
//
// Pressing on the board and dragging draws. The pointer is taken in the capture phase,
// exactly as the Shape and Connector tools take it, so pressing on a note draws over it
// instead of moving it, and a drag never becomes a pan or a marquee. While the stroke is
// in hand it is a local drawing — points collected in board units, painted as one
// screen-space SVG path once per animation frame — and nothing of it goes to Yjs: a
// colleague sees the stroke appear when the pen leaves the board, whole, never a
// half-drawn line (pen.ui / TC-18).
//
// The stroke is written at the end of the gesture, in one `LOCAL_ORIGIN` transaction
// fenced by undo boundaries, so one stroke is one undo step. Where the drawing is too long
// for one object — `STROKE_MAX_POINTS` recorded points — it is finished there and the
// drawing continues as a new stroke that starts at the point it stopped on, which is why a
// five-thousand-point line has no gap in it (pen.long_stroke).
//
// How smooth the finished line is comes from `simplify` at a tolerance of one *screen*
// pixel divided by the zoom: the same promise at every scale, because the points are
// recorded in board units and the limit is set in what an eye can see (pen.smooth).
//
// Unlike every other creating tool the Pen does not hand the board back to Select after it
// has made something: drawing is something you do for a while, and every stroke is still
// one undo step (pen.stays). Escape — or any other tool — leaves it, and a stroke still in
// hand then is dropped. An *interrupted* pointer is another matter: losing the pointer to
// the system is not an undone stroke, so the stroke is finished with the points drawn so
// far (pen.interrupted).
//
// The pointer itself is drawn as a round dot the size of the current thickness, so what
// the pen is set to is visible on the board before anything is drawn.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera.ts';
import { createStroke, penPaint, penThickness, type PenColor, type PenThickness } from '../../shared/objects/stroke.ts';
import { simplify, smoothPath } from '../../shared/geometry/simplify.ts';
import {
  DEFAULT_PEN_COLOR,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config.ts';
import { useUndoBoundary } from '../board/useUndo.ts';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  /** The id this client is credited with (`createdBy`). */
  identityId: string;
  /** The board surface this tool takes over while it is armed. */
  viewportRef: RefObject<HTMLElement | null>;
  /** False while the board is locked: the pen takes nothing. */
  canEdit?: boolean;
}

/** What the overlay shows: the stroke in hand and the round pointer. */
interface Preview {
  /** Screen-space path of the points recorded so far, in page coordinates. */
  d: string;
  /** True while a stroke is in hand. */
  drawing: boolean;
  /** Screen width of the line: the board thickness at the current zoom. */
  widthPx: number;
  /** The paint of the current colour. */
  paint: string;
  /** Where the pointer is, in page coordinates. */
  cursor: Point | null;
}

/** The coalesced moves of one pointer event, so a fast stroke keeps its shape. */
function coalesced(e: PointerEvent): PointerEvent[] {
  const withCoalescing = e as PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
  if (typeof withCoalescing.getCoalescedEvents !== 'function') return [e];
  const list = withCoalescing.getCoalescedEvents();
  return list && list.length > 0 ? list : [e];
}

/**
 * The armed Pen tool: it owns the board pointer and draws one stroke per press.
 */
export function PenTool(props: PenToolProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const viewportRef = props.viewportRef;

  // Everything the listeners read comes through a ref, so the gestures already in flight
  // never run against a camera, colour or document from an older render.
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const colorRef = useRef(props.color);
  colorRef.current = props.color;
  const thicknessRef = useRef(props.thickness);
  thicknessRef.current = props.thickness;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const byRef = useRef(props.identityId);
  byRef.current = props.identityId;
  const canEditRef = useRef(props.canEdit ?? true);
  canEditRef.current = props.canEdit ?? true;
  const boundary = useUndoBoundary();
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;

  /** The stroke in hand, in board units; null while the pen is off the board. */
  const dragRef = useRef<Point[] | null>(null);
  /** Where the pointer is, in page coordinates, for the round cursor. */
  const cursorRef = useRef<Point | null>(null);
  /** Set by the listener effect so a camera or option change repaints at once. */
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let raf = 0;

    /** The board point of a pointer event. */
    const worldOf = (e: { clientX: number; clientY: number }): Point => {
      const r = el.getBoundingClientRect();
      return screenToWorld(cameraRef.current, { x: e.clientX - r.left, y: e.clientY - r.top });
    };

    const frame = () => {
      raf = 0;
      const camera = cameraRef.current;
      const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
      const thickness = thicknessRef.current;
      const paint = penPaint(colorRef.current) ?? penPaint(DEFAULT_PEN_COLOR)!;
      const cursor = cursorRef.current;
      const drag = dragRef.current;
      const widthPx = penThickness(thickness) * zoom;
      if (!drag || drag.length === 0) {
        setPreview(cursor === null ? null : { d: '', drawing: false, widthPx, paint, cursor });
        return;
      }
      // The preview is drawn in screen space and never synced, so a colleague never sees
      // a line being drawn; the path is rebuilt from the recorded points every frame.
      const rect = el.getBoundingClientRect();
      const screen: Point[] = [];
      for (const p of drag) {
        const s = worldToScreen(camera, p);
        screen.push({ x: s.x + rect.left, y: s.y + rect.top });
      }
      setPreview({ d: smoothPath(screen), drawing: true, widthPx, paint, cursor });
    };

    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(frame);
    };
    scheduleRef.current = schedule;

    /** One finished stroke, in the document, as one undo step. */
    const commit = (points: readonly Point[]) => {
      if (points.length === 0 || !canEditRef.current) return;
      const camera = cameraRef.current;
      const zoom = Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
      // One screen pixel of deviation, however far the board is zoomed out: the recorded
      // points are board units, so the tolerance is converted before it is applied.
      const simplified = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
      boundaryRef.current();
      createStroke(docRef.current, { points: simplified, color: colorRef.current, thickness: thicknessRef.current }, byRef.current);
      boundaryRef.current();
    };

    const capture = (e: PointerEvent) => {
      const target = e.target as Element | null;
      // A press on a control inside the board — or in a text field being edited — belongs
      // to that control, not to the pen.
      if (target?.closest?.('button,[contenteditable="true"]')) return;
      if (!canEditRef.current) return; // a locked board is not a drawing surface
      // Whatever this pointer does now belongs to the pen: no pan, no marquee, and no
      // moving the object that happens to be under it.
      e.stopPropagation();
      e.preventDefault();
      dragRef.current = [worldOf(e)];
      cursorRef.current = { x: e.clientX, y: e.clientY };
      // The board keeps the pointer even when the drag runs off its edge.
      try {
        if (typeof e.pointerId === 'number' && typeof el.setPointerCapture === 'function') {
          el.setPointerCapture(e.pointerId);
        }
      } catch {
        // A synthetic pointer has no pointer to capture; the window listeners still get
        // every event while the cursor stays inside the window.
      }
      schedule();
    };

    const record = (e: PointerEvent) => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const drag = dragRef.current;
      if (drag === null) {
        schedule(); // the cursor moves; there is no stroke to add to
        return;
      }
      for (const move of coalesced(e)) drag.push(worldOf(move));
      if (drag.length >= STROKE_MAX_POINTS) {
        // Too long for one object: finish it here and carry on from this very point, so
        // the two strokes read as one line on the board.
        const part = drag.slice(0, STROKE_MAX_POINTS);
        commit(part);
        dragRef.current = [part[part.length - 1]];
      }
      schedule();
    };

    const release = (e: PointerEvent) => {
      try {
        if (typeof e.pointerId === 'number' && el.hasPointerCapture?.(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Nothing to give back.
      }
    };

    /**
     * End of the gesture. A pointer released and a pointer taken away by the system are
     * the same thing here: the stroke is finished with whatever was drawn (pen.interrupted)
     * — being interrupted is not undoing. A gesture that never got a second point still
     * becomes a dot, because that is what a press is.
     */
    const finish = (e: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      release(e);
      if (drag !== null) commit(drag);
      setPreview(null);
    };

    const droppedCapture = (e: Event) => {
      // Capture taken away by something else mid-stroke: the same finish as a release. The
      // stroke in hand is committed here and cleared, so the `pointerup` that normally
      // follows this event finds nothing to write.
      if (dragRef.current !== null) finish(e as PointerEvent);
    };

    el.addEventListener('pointerdown', capture, true);
    el.addEventListener('lostpointercapture', droppedCapture, true);
    window.addEventListener('pointermove', record, true);
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      // A stroke that was in hand when the tool went away is dropped: leaving the Pen is a
      // decision, an interruption is not.
      dragRef.current = null;
      scheduleRef.current = () => {};
      el.removeEventListener('pointerdown', capture, true);
      el.removeEventListener('lostpointercapture', droppedCapture, true);
      window.removeEventListener('pointermove', record, true);
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
    };
  }, [viewportRef]);

  // A zoom or pan mid-stroke moves the preview with the board, and a new colour shows on
  // the cursor at once rather than at the next move.
  useEffect(() => {
    scheduleRef.current();
  }, [props.camera, props.color, props.thickness]);

  return (
    <svg
      data-testid="pen-overlay"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 26,
      }}
    >
      {preview?.drawing ? (
        <path
          data-testid="pen-preview"
          d={preview.d}
          fill="none"
          stroke={preview.paint}
          strokeWidth={preview.widthPx}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {preview?.cursor ? (
        <circle
          data-testid="pen-cursor"
          cx={preview.cursor.x}
          cy={preview.cursor.y}
          r={Math.max(preview.widthPx / 2, 1)}
          fill={preview.paint}
          stroke="rgba(255,255,255,0.85)"
          strokeWidth={1}
        />
      ) : null}
    </svg>
  );
}
