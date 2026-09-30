import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import { simplify, splitPoints } from '../../shared/geometry/simplify';
import { type PenColor, type PenThickness, createStroke } from '../../shared/objects/stroke';
import type { UndoController } from '../board/undo';
import { type Camera, type Point, screenToWorld, worldToScreen } from '../canvas/camera';

const PRIMARY_BUTTON = 0;

interface Stroke {
  pointerId: number;
  /** Recorded world points of the part being drawn (never written to the document). */
  points: Point[];
  /** Screen point of the press, and whether the pointer has moved DRAG_THRESHOLD_PX away from it. */
  start: Point;
  moved: boolean;
  /** An earlier part of this drag was already committed (long stroke). */
  continued: boolean;
}

/**
 * Pen tool (pen.tool): a screen-space layer over the board that owns every
 * press, so a Pen drag never pans the board or moves objects (wheel and pinch
 * still reach the viewport). Pointer moves, coalesced ones included, are
 * recorded in world units and the local preview is redrawn once per animation
 * frame; nothing is shared until the stroke is finished. On release (or when
 * the pointer is cancelled or its capture lost) the points are simplified at
 * STROKE_SIMPLIFY_TOLERANCE_PX / zoom and committed as one stroke, one undo
 * step; a click without movement commits a dot. At STROKE_MAX_POINTS recorded
 * points the part is committed and drawing continues from its last point.
 * The tool stays active; Escape unmounts it and drops an unfinished stroke.
 */
export function PenTool(props: {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  /** `createdBy` of new strokes. */
  identityId: string;
  undo?: UndoController;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(props);
  latest.current = props;
  // Bumped once per animation frame while drawing: the preview is derived from strokeRef.
  const [frameCount, setFrameCount] = useState(0);
  const [hover, setHover] = useState<Point | null>(null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      strokeRef.current = null;
    },
    [],
  );

  const scheduleFrame = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setFrameCount((n) => n + 1);
    });
  };

  const local = (e: { clientX: number; clientY: number }): Point => {
    const rect = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  /** Commits `points` as one stroke (one undo step); a rejected stroke is dropped silently. */
  const commit = (points: readonly Point[], dot: boolean) => {
    const { doc, color, thickness, camera, undo, identityId } = latest.current;
    if (points.length === 0) return;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom;
    for (const part of dot ? [[points[0]!]] : splitPoints(points)) {
      undo?.boundary();
      createStroke(doc, { points: part.length > 1 ? simplify(part, tolerance) : part, color, thickness }, identityId);
      undo?.boundary();
    }
  };

  const append = (s: Stroke, e: { clientX: number; clientY: number }) => {
    const screen = local(e);
    if (!s.moved && Math.hypot(screen.x - s.start.x, screen.y - s.start.y) >= DRAG_THRESHOLD_PX) s.moved = true;
    const world = screenToWorld(latest.current.camera, screen);
    const last = s.points.at(-1);
    if (last && last.x === world.x && last.y === world.y) return;
    s.points.push(world);
    if (s.points.length >= STROKE_MAX_POINTS) {
      // Long stroke: finish this part and continue from its last point (no gap).
      commit(s.points, false);
      s.points = [s.points.at(-1)!];
      s.continued = true;
    }
  };

  const finish = () => {
    const s = strokeRef.current;
    if (!s) return;
    strokeRef.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    // After a long-stroke split, a lone join point is already drawn by the previous part.
    if (!(s.continued && s.points.length < 2)) commit(s.points, !s.moved);
    setFrameCount((n) => n + 1);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || strokeRef.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events (tests) have no active pointer to capture.
    }
    const start = local(e);
    strokeRef.current = {
      pointerId: e.pointerId,
      points: [screenToWorld(latest.current.camera, start)],
      start,
      moved: false,
      continued: false,
    };
    setHover(start);
    scheduleFrame();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    setHover(local(e));
    const s = strokeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    if (coalesced.length > 0) for (const c of coalesced) append(s, c);
    else append(s, e);
    scheduleFrame();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = strokeRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    append(s, e);
    finish();
  };

  // Interrupted (pointer cancelled by the system or capture lost): keep what was drawn.
  const onInterrupted = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = strokeRef.current;
    if (s && s.pointerId === e.pointerId) finish();
  };

  const { camera, color, thickness } = props;
  const width = PEN_THICKNESS_WORLD[thickness] * camera.zoom;
  const s = strokeRef.current;
  // Recomputed once per animation frame (or camera change), not on every pointer move.
  const preview = useMemo(() => {
    const points = strokeRef.current?.points;
    if (!points || points.length === 0) return null;
    const screen = points.map((p) => worldToScreen(camera, p));
    const [first, ...rest] = screen;
    return `M ${first!.x} ${first!.y} ${(rest.length > 0 ? rest : [first!]).map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
  }, [frameCount, camera]);

  return (
    <div
      ref={ref}
      className="tool-layer pen-tool"
      data-testid="pen-tool"
      data-state={s ? 'drawing' : 'idle'}
      data-color={color}
      data-thickness={thickness}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupted}
      onLostPointerCapture={onInterrupted}
      onPointerLeave={() => {
        if (!strokeRef.current) setHover(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <svg className="pen-preview-svg" aria-hidden="true" focusable="false">
          <path
            className="pen-preview"
            data-testid="pen-preview"
            d={preview}
            fill="none"
            stroke={PEN_COLORS[color]}
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
          style={{
            left: hover.x - width / 2,
            top: hover.y - width / 2,
            width,
            height: width,
            backgroundColor: PEN_COLORS[color],
          }}
        />
      )}
    </div>
  );
}
