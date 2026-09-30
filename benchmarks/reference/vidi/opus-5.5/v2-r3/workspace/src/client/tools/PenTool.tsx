import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

interface Drawing {
  pointerId: number;
  /** World points recorded for the current part of the stroke. */
  points: Point[];
  /** Viewport-local screen point of the press. */
  down: Point;
  /** Moved at least DRAG_THRESHOLD_PX from the press (otherwise release draws a dot). */
  moved: boolean;
  /** Zoom when the stroke started: the smoothing tolerance is 1 screen pixel at this zoom. */
  zoom: number;
  /** A part was already committed (a very long stroke continues from its last point). */
  continued: boolean;
}

/**
 * Pen tool layer (story 11, pen.tool). Covers the board and owns every press,
 * so a Pen drag never pans the board or moves objects underneath; wheel and
 * pinch still reach the viewport (pen.navigation). The line being drawn is a
 * local screen-space preview redrawn once per animation frame and never written
 * to the document, so others only see finished strokes (pen.share). Release,
 * pointercancel and lost pointer capture all finish the stroke; a press without
 * movement draws a dot. The tool stays active after each stroke.
 */
export function PenTool(props: { camera: Camera; color: PenColor; thickness: PenThickness; doc: Y.Doc; identityId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drawingRef = useRef<Drawing | null>(null);
  const frameRef = useRef<number | null>(null);
  const hoverRef = useRef<Point | null>(null);
  const [, setFrame] = useState(0);
  const undo = useUndoController();
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  /** Redraw the preview and cursor at most once per displayed frame. */
  const scheduleFrame = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setFrame((n) => n + 1);
    });
  };

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** One stroke object for `points` (already in world units); null when the model rejects it. */
  const commit = (points: readonly Point[], dot: boolean, zoom: number) => {
    const { doc, color, thickness, identityId } = propsRef.current;
    const pts = dot ? points.slice(0, 1) : simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    undo.boundary();
    // A rejected stroke (e.g. non-finite points) is dropped silently with its preview.
    createStroke(doc, { points: pts, color, thickness }, identityId);
    undo.boundary();
  };

  const append = (d: Drawing, screen: Point) => {
    const world = screenToWorld(propsRef.current.camera, screen);
    const last = d.points[d.points.length - 1];
    if (last && last.x === world.x && last.y === world.y) return;
    d.points.push(world);
    if (!d.moved && Math.hypot(screen.x - d.down.x, screen.y - d.down.y) >= DRAG_THRESHOLD_PX) d.moved = true;
    if (d.points.length >= STROKE_MAX_POINTS) {
      // pen.long_stroke: finish this part and continue from its last point, so there is no gap.
      commit(d.points, false, d.zoom);
      d.points = [d.points[d.points.length - 1]];
      d.continued = true;
      d.moved = true;
    }
  };

  const finish = () => {
    const d = drawingRef.current;
    if (!d) return;
    drawingRef.current = null;
    // After a split, a remainder that is only the join point adds nothing.
    if (!(d.continued && d.points.length < 2)) commit(d.points, !d.moved, d.zoom);
    setFrame((n) => n + 1);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || drawingRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Unavailable for synthetic events; events still reach the layer.
    }
    const p = local(e);
    hoverRef.current = p;
    drawingRef.current = {
      pointerId: e.pointerId,
      points: [screenToWorld(props.camera, p)],
      down: p,
      moved: false,
      zoom: props.camera.zoom,
      continued: false,
    };
    scheduleFrame();
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = local(e);
    hoverRef.current = p;
    const d = drawingRef.current;
    if (d && d.pointerId === e.pointerId) {
      const native = e.nativeEvent as globalThis.PointerEvent;
      const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      if (coalesced.length > 0) for (const c of coalesced) append(d, local(c));
      else append(d, p);
    }
    scheduleFrame();
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    append(d, local(e));
    finish();
  };

  // pen.interrupted: a cancelled drag or lost capture keeps what was drawn.
  const onInterrupted = (e: PointerEvent<HTMLDivElement>) => {
    if (drawingRef.current?.pointerId === e.pointerId) finish();
  };

  const { camera } = props;
  const color = PEN_COLORS[props.color];
  const width = PEN_THICKNESS_WORLD[props.thickness] * camera.zoom;
  const d = drawingRef.current;
  let preview: string | null = null;
  if (d) {
    const s = d.points.map((w) => worldToScreen(camera, w));
    preview = s.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    if (s.length === 1) preview += ` L ${s[0].x} ${s[0].y}`;
  }
  const hover = hoverRef.current;

  return (
    <div
      ref={ref}
      className="tool-layer pen-tool"
      data-testid="pen-tool"
      data-state={d ? 'drawing' : 'ready'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupted}
      onLostPointerCapture={onInterrupted}
      onPointerLeave={() => {
        if (drawingRef.current) return;
        hoverRef.current = null;
        scheduleFrame();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview !== null && (
        <svg className="pen-preview-svg" aria-hidden="true" focusable="false">
          <path
            data-testid="pen-preview"
            d={preview}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {hover && (
        <div
          className="pen-cursor"
          data-testid="pen-cursor"
          aria-hidden="true"
          style={{ left: hover.x - width / 2, top: hover.y - width / 2, width, height: width, background: color }}
        />
      )}
    </div>
  );
}
