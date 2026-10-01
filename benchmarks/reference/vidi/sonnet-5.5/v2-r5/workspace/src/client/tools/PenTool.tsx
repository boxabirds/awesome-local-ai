import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX, PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point as WorldPoint } from '../../shared/geometry';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import type { UndoController } from '../board/undo';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useForwardWheel } from './useForwardWheel';

const PRIMARY_BUTTON = 0;
const HALF = 2;

interface Gesture { pointerId: number; zoom: number; start: Point; moved: boolean; points: WorldPoint[] }

/**
 * Full-board layer while the Pen tool is active. It owns the pointer gesture (so a drag never pans or moves
 * what is underneath); the in-progress line is a local overlay and is only written to the document on finish.
 */
export function PenTool(props: {
  camera: Camera; color: PenColor; thickness: PenThickness; doc: Y.Doc; identityId: string; undo?: UndoController;
}) {
  const { camera, doc, identityId, undo } = props;
  const layer = useRef<HTMLDivElement>(null);
  const pathEl = useRef<SVGPathElement>(null);
  const cursorEl = useRef<HTMLDivElement>(null);
  useForwardWheel(layer);
  const [drawing, setDrawing] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const opts = useRef(props);
  opts.current = props;

  const localOf = (e: { clientX: number; clientY: number }): Point => {
    const r = layer.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const paint = () => {
    frame.current = null;
    const g = gesture.current;
    if (!g || !pathEl.current) return;
    const cam = opts.current.camera;
    pathEl.current.setAttribute('d', smoothPath(g.points.map((p) => worldToScreen(cam, p))));
  };
  const schedule = () => {
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  };
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const commit = (points: WorldPoint[], zoom: number, dot: boolean) => {
    const { color, thickness } = opts.current;
    const pts = dot ? [points[0]] : simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    undo?.boundary();
    createStroke(doc, { points: pts, color, thickness }, identityId);
    undo?.boundary();
  };

  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    setDrawing(false);
    if (!g || g.points.length === 0) return;
    // A continuation part that holds only its join point has nothing new to draw.
    if (g.points.length === 1 && g.moved) return;
    commit(g.points, g.zoom, !g.moved);
  };

  const append = (g: Gesture, e: { clientX: number; clientY: number }) => {
    const local = localOf(e);
    if (!g.moved && Math.hypot(local.x - g.start.x, local.y - g.start.y) >= DRAG_THRESHOLD_PX) g.moved = true;
    g.points.push(screenToWorld(opts.current.camera, local));
    if (g.points.length >= STROKE_MAX_POINTS) {
      const last = g.points[g.points.length - 1];
      commit(g.points, g.zoom, false);
      g.points = [last];
    }
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON || gesture.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const local = localOf(e);
    gesture.current = {
      pointerId: e.pointerId, zoom: camera.zoom, start: local, moved: false,
      points: [screenToWorld(camera, local)],
    };
    setDrawing(true);
    schedule();
  };
  const moveCursor = (e: { clientX: number; clientY: number }) => {
    const c = cursorEl.current;
    if (!c) return;
    const p = localOf(e);
    c.style.transform = `translate(${p.x}px, ${p.y}px)`;
    c.style.display = 'block';
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    moveCursor(e);
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    if (events.length > 0) events.forEach((ev) => append(g, ev)); else append(g, e);
    schedule();
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    append(g, e);
    finish();
  };
  const onEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (gesture.current && gesture.current.pointerId === e.pointerId) finish();
  };

  const diameter = PEN_THICKNESS_WORLD[props.thickness] * camera.zoom;
  return (
    <div
      ref={layer}
      className="tool-layer pen-tool-layer"
      data-testid="pen-tool-layer"
      style={{ cursor: 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onEnd}
      onLostPointerCapture={onEnd}
      onPointerLeave={() => { if (cursorEl.current) cursorEl.current.style.display = 'none'; }}
    >
      <div
        ref={cursorEl}
        className="pen-cursor"
        data-testid="pen-cursor"
        style={{
          display: 'none', width: diameter, height: diameter, marginLeft: -diameter / HALF, marginTop: -diameter / HALF,
          borderColor: PEN_COLORS[props.color],
        }}
      />
      {drawing && (
        <svg className="pen-preview" width="100%" height="100%" aria-hidden="true">
          <path
            ref={pathEl}
            data-testid="pen-preview"
            fill="none"
            stroke={PEN_COLORS[props.color]}
            strokeWidth={diameter}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
