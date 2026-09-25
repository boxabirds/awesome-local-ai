/**
 * The Pen tool's input layer (anchors: pen.draw, pen.dot, pen.stay_active, pen.navigation,
 * pen.share, pen.long_stroke, pen.interrupted).
 *
 * A screen-space layer over the whole board while the Pen is active: it owns every press,
 * so a drag never pans the board or moves an object underneath, while wheel and pinch
 * events bubble to the viewport and still pan / zoom. A drag records world points (all
 * coalesced pointer events when the browser offers them) and redraws a local preview path
 * once per animation frame; the preview is never written to the board, so nobody else sees
 * a stroke being drawn. Release commits one stroke, simplified to within
 * STROKE_SIMPLIFY_TOLERANCE_PX screen pixels; a press without moving DRAG_THRESHOLD_PX
 * commits a dot. At STROKE_MAX_POINTS recorded points the part so far is committed and
 * drawing continues from its last point. pointercancel / lost capture commit what was drawn.
 * Each commit is its own undo step; the Pen stays active. A round cursor shows the
 * thickness at the current zoom.
 */
import { useContext, useEffect, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { UndoContext } from '../board/useUndo';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { simplify } from '../../shared/geometry/simplify';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import { PRIMARY_BUTTON } from './toolLayer';

const HALF = 2;

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  /** Identity stored as `createdBy`. */
  identityId: string;
}

interface Drawing {
  pointerId: number;
  /** Screen position of the press, for the click-or-drag decision. */
  start: Point;
  /** True once the pointer went DRAG_THRESHOLD_PX from the press. */
  moved: boolean;
  /** World points of the current part. */
  points: Point[];
  /** Layer position on screen, taken at the press. */
  origin: Point;
}

/** Screen-space preview path through the world points. */
function previewPath(points: readonly Point[], camera: Camera): string {
  if (points.length === 0) return '';
  let d = '';
  for (let i = 0; i < points.length; i += 1) {
    const s = worldToScreen(camera, points[i]!);
    d += `${i === 0 ? 'M' : ' L'} ${s.x} ${s.y}`;
  }
  if (points.length === 1) {
    const s = worldToScreen(camera, points[0]!);
    d += ` L ${s.x} ${s.y}`;
  }
  return d;
}

export function PenTool(props: PenToolProps): React.JSX.Element {
  const history = useContext(UndoContext);
  const drawing = useRef<Drawing | null>(null);
  const [active, setActive] = useState(false);
  const pathRef = useRef<SVGPathElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(
    () => () => {
      // Leaving the Pen (Escape, another tool) mid-drag abandons the stroke.
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      drawing.current = null;
    },
    [],
  );

  const redraw = () => {
    frame.current = null;
    const d = drawing.current;
    if (d !== null) pathRef.current?.setAttribute('d', previewPath(d.points, latest.current.camera));
  };
  const scheduleRedraw = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(redraw);
  };
  // The camera can move while drawing (wheel): keep the preview on the drawn points.
  useEffect(() => {
    if (drawing.current !== null) scheduleRedraw();
  });

  /** Commits `points` as one stroke (one undo step); a rejected stroke is dropped silently. */
  const commit = (points: readonly Point[], dot: boolean) => {
    const { camera, color, thickness, doc, identityId } = latest.current;
    if (points.length === 0) return;
    const finished = dot ? [points[0]!] : simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom);
    history.boundary();
    createStroke(doc, { points: finished, color, thickness }, identityId);
    history.boundary();
  };

  const append = (d: Drawing, clientX: number, clientY: number) => {
    const screen = { x: clientX - d.origin.x, y: clientY - d.origin.y };
    if (!d.moved && Math.hypot(screen.x - d.start.x, screen.y - d.start.y) >= DRAG_THRESHOLD_PX) d.moved = true;
    d.points.push(screenToWorld(latest.current.camera, screen));
    if (d.points.length >= STROKE_MAX_POINTS) {
      // pen.long_stroke: finish this part, continue from its last point.
      const last = d.points[d.points.length - 1]!;
      commit(d.points, false);
      d.points = [last];
    }
  };

  const finish = () => {
    const d = drawing.current;
    if (d === null) return;
    drawing.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    pathRef.current?.setAttribute('d', '');
    setActive(false);
    // After a split the remaining part always continues a drag, even if it is one point.
    commit(d.points, !d.moved);
  };

  const moveCursor = (e: PointerEvent<HTMLDivElement>) => {
    const el = cursorRef.current;
    if (el === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px)`;
    el.style.visibility = 'visible';
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== PRIMARY_BUTTON || drawing.current !== null) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    const start = { x: e.clientX - origin.x, y: e.clientY - origin.y };
    drawing.current = {
      pointerId: e.pointerId,
      start,
      moved: false,
      points: [screenToWorld(props.camera, start)],
      origin,
    };
    setActive(true);
    moveCursor(e);
    scheduleRedraw();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    moveCursor(e);
    const d = drawing.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const native = e.nativeEvent as globalThis.PointerEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    if (coalesced.length > 0) for (const c of coalesced) append(d, c.clientX, c.clientY);
    else append(d, e.clientX, e.clientY);
    scheduleRedraw();
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drawing.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    const last = d.points[d.points.length - 1];
    const end = screenToWorld(props.camera, { x: e.clientX - d.origin.x, y: e.clientY - d.origin.y });
    if (last === undefined || last.x !== end.x || last.y !== end.y) append(d, e.clientX, e.clientY);
    finish();
  };
  const onInterrupted = (e: PointerEvent<HTMLDivElement>) => {
    const d = drawing.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    finish();
  };

  const { camera, color, thickness } = props;
  const size = PEN_THICKNESS_WORLD[thickness] * camera.zoom;
  return (
    <div
      className="tool-layer pen-tool"
      data-testid="pen-tool"
      data-color={color}
      data-thickness={thickness}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupted}
      onLostPointerCapture={onInterrupted}
      onPointerLeave={() => {
        if (cursorRef.current !== null) cursorRef.current.style.visibility = 'hidden';
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {active && (
        <svg className="pen-preview" aria-hidden="true" focusable="false">
          <path
            ref={pathRef}
            data-testid="pen-preview"
            d=""
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={size}
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
          width: `${size}px`,
          height: `${size}px`,
          margin: `${-size / HALF}px 0 0 ${-size / HALF}px`,
          borderColor: PEN_COLORS[color],
          visibility: 'hidden',
        }}
      />
    </div>
  );
}
