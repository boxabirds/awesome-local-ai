import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { DRAG_THRESHOLD_PX, PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { NO_UNDO, type UndoController } from '../board/undo';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { ToolLayer } from './ToolLayer';

interface Gesture {
  pointerId: number;
  /** Board-space points of the part being drawn. */
  points: Point[];
  startScreen: Point;
  /** Furthest screen distance from the start; below the drag threshold the gesture is a click (a dot). */
  maxMoved: number;
  /** Zoom while drawing: the smoothing tolerance is one screen pixel at this zoom. */
  zoom: number;
  /** True once a part was committed because of the point limit; a lone leftover join point is then not a dot. */
  split: boolean;
}

/**
 * Pen tool: drag to draw, with the stroke previewed only on this screen (never written to the document); on release,
 * interruption or reaching STROKE_MAX_POINTS the points are simplified and committed as one stroke object. The tool
 * stays active after each stroke.
 */
export function PenTool(props: { camera: Camera; color: PenColor; thickness: PenThickness; doc: Y.Doc; identityId: string; undo?: UndoController }) {
  const { camera } = props;
  const undo = props.undo ?? NO_UNDO;
  const latest = useRef(props);
  latest.current = props;
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef<number | null>(null);
  const [, setTick] = useState(0);
  const [pointer, setPointer] = useState<Point | null>(null);

  const schedule = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setTick((n) => n + 1);
    });
  };
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const commit = (g: Gesture, asDot: boolean) => {
    const { doc, color, thickness, identityId } = latest.current;
    const pts = asDot ? [g.points[0]] : simplify(g.points, STROKE_SIMPLIFY_TOLERANCE_PX / g.zoom);
    undo.boundary();
    createStroke(doc, { points: pts, color, thickness }, identityId);
    undo.boundary();
  };

  const append = (g: Gesture, e: { clientX: number; clientY: number }) => {
    const s = { x: e.clientX, y: e.clientY };
    const w = screenToWorld(camera, s);
    const last = g.points[g.points.length - 1];
    g.maxMoved = Math.max(g.maxMoved, Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y));
    if (last && last.x === w.x && last.y === w.y) return;
    g.points.push(w);
    if (g.points.length >= STROKE_MAX_POINTS) {
      commit(g, false);
      g.points = [w];
      g.split = true;
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = { x: e.clientX, y: e.clientY };
    gesture.current = { pointerId: e.pointerId, points: [screenToWorld(camera, s)], startScreen: s, maxMoved: 0, zoom: camera.zoom, split: false };
    setPointer(s);
    schedule();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    setPointer({ x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const events = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    for (const c of events.length > 0 ? events : [e]) append(g, c);
    schedule();
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, withPoint: boolean) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    if (withPoint) append(g, e);
    if (g.split && g.points.length === 1) return schedule();
    commit(g, g.points.length === 1 || g.maxMoved < DRAG_THRESHOLD_PX);
    schedule();
  };

  const g = gesture.current;
  const preview = g && g.points.length > 0 ? smoothPath(g.points.map((p) => worldToScreen(camera, p))) : '';
  const widthPx = PEN_THICKNESS_WORLD[props.thickness] * camera.zoom;
  return (
    <ToolLayer
      testId="pen-tool-layer"
      cursor="none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, true)}
      onPointerCancel={(e) => finish(e, false)}
      onPointerLeave={() => {
        if (!gesture.current) setPointer(null);
      }}
    >
      {preview && (
        <svg data-testid="pen-preview" width="100%" height="100%" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-hidden="true">
          <path d={preview} fill="none" stroke={PEN_COLORS[props.color]} strokeWidth={widthPx} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {pointer && (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'fixed',
            left: pointer.x - Math.max(widthPx, 2) / 2,
            top: pointer.y - Math.max(widthPx, 2) / 2,
            width: Math.max(widthPx, 2),
            height: Math.max(widthPx, 2),
            borderRadius: '50%',
            background: PEN_COLORS[props.color],
            boxShadow: '0 0 0 1px rgba(255,255,255,0.8)',
            pointerEvents: 'none',
          }}
        />
      )}
    </ToolLayer>
  );
}
