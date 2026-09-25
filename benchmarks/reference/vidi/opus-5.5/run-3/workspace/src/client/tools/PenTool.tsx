import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { polylinePath, simplify } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { asStep, UndoContext } from '../board/useUndo';

interface Drawing {
  pointerId: number;
  /** World points of the current part (raw, as recorded). */
  points: Point[];
  /** Pressed point, viewport px. */
  start: Point;
  /** The pointer has moved DRAG_THRESHOLD_PX or more from the press: not a dot. */
  moved: boolean;
  /** Parts already committed (a long stroke is split at STROKE_MAX_POINTS). */
  parts: number;
  /** Zoom when the stroke began: the smoothing tolerance is 1 screen px at this zoom. */
  zoom: number;
}

/**
 * The Pen tool's input surface over the whole board (pen.draw, pen.navigation). It takes every press on the board,
 * objects included, so a pen drag never pans or moves anything; wheel and pinch still reach the viewport. While
 * drawing, the recorded points (coalesced events included) are shown as a local screen-space preview redrawn once
 * per animation frame and never written to the doc, so nobody else sees an unfinished stroke (pen.share).
 *
 * The release commits one stroke simplified to STROKE_SIMPLIFY_TOLERANCE_PX on screen (pen.smooth) as its own
 * undo step; a press without movement commits a dot (pen.dot); pointercancel or lost capture commits the points so
 * far (pen.interrupted); reaching STROKE_MAX_POINTS commits a part and continues from its last point
 * (pen.long_stroke). The tool stays active afterwards (pen.stay_active).
 */
export function PenTool(props: {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const undo = useContext(UndoContext);
  const latest = useRef({ ...props, undo });
  latest.current = { ...props, undo };
  const drawingRef = useRef<Drawing | null>(null);
  const frameRef = useRef<number | null>(null);
  const [drawing, setDrawing] = useState(false);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const redraw = () => {
    const d = drawingRef.current;
    const path = pathRef.current;
    if (!d || !path) return;
    const { camera } = latest.current;
    path.setAttribute('d', polylinePath(d.points.map((p) => worldToScreen(camera, p))));
  };
  const scheduleRedraw = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      redraw();
    });
  };

  /** Commits the current part. Null results (invalid input) are dropped silently. */
  const commit = (d: Drawing) => {
    const { doc, color, thickness, identityId, undo: u } = latest.current;
    if (d.points.length === 0) return;
    const points = !d.moved && d.parts === 0 ? [d.points[0]] : simplify(d.points, STROKE_SIMPLIFY_TOLERANCE_PX / d.zoom);
    asStep(u, () => createStroke(doc, { points, color, thickness }, identityId));
    d.parts++;
  };

  const append = (d: Drawing, p: Point) => {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const last = d.points[d.points.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    d.points.push(p);
    if (d.points.length >= STROKE_MAX_POINTS) {
      d.moved = true;
      commit(d);
      d.points = [d.points[d.points.length - 1]];
    }
  };

  const finish = () => {
    const d = drawingRef.current;
    if (!d) return;
    drawingRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    // After a split, a remainder of just the join point adds nothing.
    if (d.parts === 0 || d.points.length > 1) commit(d);
    pathRef.current?.setAttribute('d', '');
    setDrawing(false);
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Leaving the tool mid-stroke keeps what was drawn, as an interruption does.
  useEffect(() => () => finishRef.current(), []);

  // The camera can change mid-stroke (wheel): the preview follows it.
  useLayoutEffect(() => {
    if (drawingRef.current) redraw();
  });

  const moveCursor = (e: { clientX: number; clientY: number }) => {
    const el = cursorRef.current;
    if (!el) return;
    const p = local(e);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.style.visibility = 'visible';
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || drawingRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Synthetic pointer: moves still arrive while over the surface.
    }
    const at = local(e);
    const d: Drawing = { pointerId: e.pointerId, points: [], start: at, moved: false, parts: 0, zoom: props.camera.zoom };
    append(d, screenToWorld(props.camera, at));
    drawingRef.current = d;
    setDrawing(true);
    moveCursor(e);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    moveCursor(e);
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [e];
    const { camera } = latest.current;
    for (const ev of events) {
      const at = local(ev);
      if (!d.moved && Math.hypot(at.x - d.start.x, at.y - d.start.y) >= DRAG_THRESHOLD_PX) d.moved = true;
      append(d, screenToWorld(camera, at));
    }
    scheduleRedraw();
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const at = local(e);
    if (!d.moved && Math.hypot(at.x - d.start.x, at.y - d.start.y) >= DRAG_THRESHOLD_PX) d.moved = true;
    append(d, screenToWorld(latest.current.camera, at));
    finish();
  };
  const onInterrupted = (e: ReactPointerEvent) => {
    if (drawingRef.current?.pointerId === e.pointerId) finish();
  };

  const width = PEN_THICKNESS_WORLD[props.thickness] * props.camera.zoom;
  const colour = PEN_COLORS[props.color];
  const cursorSize = Math.max(2, width);

  return (
    <div
      ref={ref}
      className="tool-surface tool-surface--pen"
      data-testid="pen-tool"
      data-color={props.color}
      data-thickness={props.thickness}
      data-state={drawing ? 'drawing' : 'idle'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupted}
      onLostPointerCapture={onInterrupted}
      onPointerLeave={() => {
        if (cursorRef.current && !drawingRef.current) cursorRef.current.style.visibility = 'hidden';
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {drawing && (
        <svg className="pen-preview" aria-hidden="true">
          <path
            ref={pathRef}
            data-testid="pen-preview"
            fill="none"
            stroke={colour}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div
        ref={cursorRef}
        className="pen-cursor"
        data-testid="pen-cursor"
        aria-hidden="true"
        style={{
          width: cursorSize,
          height: cursorSize,
          marginLeft: -cursorSize / 2,
          marginTop: -cursorSize / 2,
          background: colour,
          visibility: 'hidden',
        }}
      />
    </div>
  );
}
