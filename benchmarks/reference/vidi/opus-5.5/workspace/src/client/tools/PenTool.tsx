import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
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
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

const PRIMARY_BUTTON = 0;
/** Decimals of the screen-space preview path (sub-pixel). */
const PREVIEW_DECIMALS = 1;

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  /** Recorded as the stroke's `createdBy`. */
  identityId: string;
  /** Runs each commit as one undo step (story 8); default: run it as is. */
  step?<T>(action: () => T): T;
}

/** The stroke being drawn: world points recorded so far (local only, never in the document). */
interface Drawing {
  pointerId: number;
  points: Point[];
  /** Board-area point of the press, for the click-vs-drag decision. */
  startScreen: Point;
  moved: boolean;
  /** Parts already committed because the stroke reached STROKE_MAX_POINTS. */
  parts: number;
  /** Camera zoom while drawing (smoothing tolerance is in screen px at this zoom). */
  zoom: number;
}

const run = <T,>(action: () => T): T => action();

function localPoint(el: Element, e: { clientX: number; clientY: number }): Point {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** The pointer samples behind one pointermove: the coalesced ones when the browser offers them. */
function samples(e: ReactPointerEvent<HTMLDivElement>): { clientX: number; clientY: number }[] {
  const native = e.nativeEvent as PointerEvent;
  const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
  return coalesced.length > 0 ? coalesced : [e];
}

function fmt(n: number): string {
  return n.toFixed(PREVIEW_DECIMALS);
}

/** Screen-space polyline of the recorded points (a single point draws as a round dot). */
function previewPath(cam: Camera, points: readonly Point[]): string {
  if (points.length === 0) return '';
  const s = points.map((p) => worldToScreen(cam, p));
  const head = `M${fmt(s[0]!.x)} ${fmt(s[0]!.y)}`;
  if (s.length === 1) return `${head}L${fmt(s[0]!.x)} ${fmt(s[0]!.y)}`;
  let d = head;
  for (let i = 1; i < s.length; i += 1) d += `L${fmt(s[i]!.x)} ${fmt(s[i]!.y)}`;
  return d;
}

/**
 * The Pen tool (story 11): a transparent layer over the whole board that owns every press
 * while the Pen is active, so a drag over an object draws instead of moving it and never pans
 * (pen.navigation; wheel and pinch still reach the board). A drag records the pointer's
 * (coalesced) positions and redraws a local screen-space preview once per animation frame;
 * nothing is written to the document until the stroke is finished, so others never see a
 * stroke being drawn (pen.share). Release commits one stroke simplified to within
 * STROKE_SIMPLIFY_TOLERANCE_PX screen px (pen.smooth); a click commits a dot (pen.dot);
 * pointercancel / lost capture commit the points so far (pen.interrupted); reaching
 * STROKE_MAX_POINTS commits the part and continues from its last point (pen.long_stroke).
 * The tool stays active after each stroke (pen.stay_active).
 */
export function PenTool({ camera, color, thickness, doc, identityId, step = run }: PenToolProps) {
  const drawingRef = useRef<Drawing | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const latest = useRef({ camera, color, thickness, doc, identityId, step });
  latest.current = { camera, color, thickness, doc, identityId, step };

  const draw = () => {
    frameRef.current = null;
    const path = pathRef.current;
    if (!path) return;
    const d = drawingRef.current;
    path.setAttribute('d', d ? previewPath(latest.current.camera, d.points) : '');
  };

  /** Redraws the preview at the next animation frame (at most once per frame). */
  const schedule = () => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw);
  };

  useEffect(
    () => () => {
      // Escape or another tool mid-stroke: the preview is discarded, nothing is committed.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      drawingRef.current = null;
    },
    [],
  );

  // Navigating while drawing (wheel) moves the preview with the board.
  useLayoutEffect(() => {
    if (drawingRef.current) schedule();
  }, [camera]);

  /** Commits one stroke (or dot) from world points; a rejected stroke is dropped silently. */
  const commit = (points: readonly Point[], dot: boolean, zoom: number) => {
    const { color: c, thickness: t, doc: d, identityId: by, step: asStep } = latest.current;
    const finished = dot ? [points[0]!] : simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    asStep(() => createStroke(d, { points: finished, color: c, thickness: t }, by));
  };

  const finish = () => {
    const d = drawingRef.current;
    if (!d) return;
    drawingRef.current = null;
    if (d.parts === 0 || d.points.length > 1) commit(d.points, !d.moved, d.zoom);
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pathRef.current?.setAttribute('d', '');
  };

  const moveCursor = (p: Point) => {
    const el = cursorRef.current;
    if (!el) return;
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    el.style.visibility = 'visible';
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || drawingRef.current) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // The release still arrives without capture.
    }
    const p = localPoint(e.currentTarget, e);
    const cam = latest.current.camera;
    drawingRef.current = {
      pointerId: e.pointerId,
      points: [screenToWorld(cam, p)],
      startScreen: p,
      moved: false,
      parts: 0,
      zoom: cam.zoom,
    };
    moveCursor(p);
    schedule();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    moveCursor({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const cam = latest.current.camera;
    for (const s of samples(e)) {
      const p = { x: s.clientX - rect.left, y: s.clientY - rect.top };
      if (!d.moved && Math.hypot(p.x - d.startScreen.x, p.y - d.startScreen.y) >= DRAG_THRESHOLD_PX) d.moved = true;
      d.points.push(screenToWorld(cam, p));
      if (d.points.length >= STROKE_MAX_POINTS) {
        // Long stroke: finish this part and continue as a new stroke from the same point.
        const last = d.points[d.points.length - 1]!;
        commit(d.points, false, d.zoom);
        d.points = [last];
        d.parts += 1;
      }
    }
    schedule();
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    e.stopPropagation();
    if (e.type === 'pointerup') {
      const rect = e.currentTarget.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const last = d.points[d.points.length - 1]!;
      const world = screenToWorld(latest.current.camera, p);
      if (Math.hypot(p.x - d.startScreen.x, p.y - d.startScreen.y) >= DRAG_THRESHOLD_PX) d.moved = true;
      if (d.moved && (world.x !== last.x || world.y !== last.y)) d.points.push(world);
    }
    finish();
  };

  const size = PEN_THICKNESS_WORLD[thickness] * camera.zoom;
  const cursorStyle: CSSProperties = {
    width: size,
    height: size,
    borderColor: PEN_COLORS[color],
    visibility: 'hidden',
  };

  return (
    <div
      className="tool-layer tool-layer--pen"
      data-testid="pen-tool"
      data-color={color}
      data-thickness={thickness}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onPointerLeave={() => {
        if (!drawingRef.current && cursorRef.current) cursorRef.current.style.visibility = 'hidden';
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <svg className="tool-layer__svg" aria-hidden="true" focusable="false">
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
      <div
        ref={cursorRef}
        className="pen-cursor"
        data-testid="pen-cursor"
        data-size={size}
        style={cursorStyle}
        aria-hidden="true"
      />
    </div>
  );
}

