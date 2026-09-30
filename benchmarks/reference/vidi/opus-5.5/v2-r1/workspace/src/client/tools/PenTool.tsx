// Pen tool (story 11): freehand strokes. While active it owns every press on the board (so a
// drag never pans or moves an object underneath); wheel and pinch still navigate. The stroke
// being drawn is a local screen-space preview, redrawn once per animation frame and never
// written to the board, so nobody else sees it. On release (or when the drag is interrupted, or
// at STROKE_MAX_POINTS recorded points) it is simplified and committed as one stroke object.
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify } from '../../shared/geometry/simplify';
import { type PenColor, type PenThickness, createStroke } from '../../shared/objects/stroke';
import { useUndoController } from '../board/useUndo';
import { type Camera, screenToWorld, worldToScreen } from '../canvas/camera';

const PRIMARY_BUTTON = 0;
/** The round cursor is never drawn smaller than this, screen px. */
const MIN_CURSOR_PX = 3;
/** Browsers ignore cursor images larger than this. */
const MAX_CURSOR_PX = 120;

interface Drawing {
  pointerId: number;
  /** Recorded points of the current part, world units. */
  points: Point[];
  /** Press point, client px. */
  startClient: Point;
  /** Moved at least DRAG_THRESHOLD_PX from the press point (a drag, not a click). */
  moved: boolean;
  /** Parts already committed because the stroke reached STROKE_MAX_POINTS. */
  parts: number;
}

/** A round cursor the size of the line at the current zoom (CSS cursor image). */
export function penCursor(color: PenColor, thickness: PenThickness, zoom: number): string {
  const d = Math.min(MAX_CURSOR_PX, Math.max(MIN_CURSOR_PX, PEN_THICKNESS_WORLD[thickness] * zoom));
  const size = Math.ceil(d) + 4;
  const c = size / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${c}" cy="${c}" r="${d / 2 + 1}" fill="white" fill-opacity="0.8"/>` +
    `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="${PEN_COLORS[color]}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
}

function previewPath(points: readonly Point[], camera: Camera): string {
  if (points.length === 0) return '';
  const s = points.map((p) => worldToScreen(camera, p));
  const fmt = (p: Point) => `${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`;
  if (s.length === 1) return `M ${fmt(s[0])} L ${fmt(s[0])}`;
  return `M ${fmt(s[0])} ${s
    .slice(1)
    .map((p) => `L ${fmt(p)}`)
    .join(' ')}`;
}

export function PenTool(props: {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
}) {
  const history = useUndoController();
  const propsRef = useRef(props);
  propsRef.current = props;
  const historyRef = useRef(history);
  historyRef.current = history;
  const drawingRef = useRef<Drawing | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [preview, setPreview] = useState('');

  const redraw = () => {
    frameRef.current = null;
    const d = drawingRef.current;
    // Applied within this frame, so the line is on screen in the frame after the pointer moved.
    flushSync(() => setPreview(d ? previewPath(d.points, propsRef.current.camera) : ''));
  };
  const scheduleRedraw = () => {
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(redraw);
  };
  const cancelRedraw = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  /** Commits world points as one stroke (one undo step); false when the model rejects them. */
  const commit = (points: readonly Point[], simplifyIt: boolean) => {
    const { doc, color, thickness, identityId, camera } = propsRef.current;
    const pts = simplifyIt ? simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom) : points;
    historyRef.current?.boundary();
    const id = createStroke(doc, { points: pts, color, thickness }, identityId);
    historyRef.current?.boundary();
    return id !== null;
  };

  /** Ends the stroke being drawn and commits the points recorded so far. */
  const finish = () => {
    const d = drawingRef.current;
    if (!d) return;
    drawingRef.current = null;
    cancelRedraw();
    setPreview('');
    if (!d.moved) {
      // A click: a round dot at the press point.
      commit(d.points.slice(0, 1), false);
    } else if (d.parts === 0 || d.points.length > 1) {
      commit(d.points, true);
    }
  };

  // Leaving the tool (Escape, another tool) in the middle of a drag keeps what was drawn.
  useEffect(
    () => () => {
      finish();
      cancelRedraw();
    },
    [],
  );

  const worldAt = (clientX: number, clientY: number): Point => {
    const r = layerRef.current!.getBoundingClientRect();
    return screenToWorld(propsRef.current.camera, { x: clientX - r.left, y: clientY - r.top });
  };

  const record = (d: Drawing, clientX: number, clientY: number) => {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    if (Math.hypot(clientX - d.startClient.x, clientY - d.startClient.y) >= DRAG_THRESHOLD_PX) d.moved = true;
    const p = worldAt(clientX, clientY);
    const last = d.points[d.points.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    d.points.push(p);
    if (d.points.length >= STROKE_MAX_POINTS) {
      // Very long stroke: commit this part and continue from its last point (no gap).
      commit(d.points, true);
      d.parts++;
      d.points = [p];
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== PRIMARY_BUTTON || drawingRef.current) return;
    // No focus change and no text selection from the press.
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // The pointer is already gone; the drag ends with pointerup/cancel anyway.
    }
    drawingRef.current = {
      pointerId: e.pointerId,
      points: [worldAt(e.clientX, e.clientY)],
      startClient: { x: e.clientX, y: e.clientY },
      moved: false,
      parts: 0,
    };
    scheduleRedraw();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const native = e.nativeEvent as PointerEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    if (coalesced.length > 0) for (const c of coalesced) record(d, c.clientX, c.clientY);
    else record(d, e.clientX, e.clientY);
    scheduleRedraw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.stopPropagation();
    record(d, e.clientX, e.clientY);
    finish();
  };

  // Interrupted (capture lost, cancelled by the system): the stroke so far is kept.
  const onInterrupt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    finish();
  };

  const { camera, color, thickness } = props;
  const style = { cursor: penCursor(color, thickness, camera.zoom) } as CSSProperties;
  const cursorSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  return (
    <div
      ref={layerRef}
      className="tool-layer pen-tool"
      data-testid="pen-tool"
      data-cursor-size={cursorSize}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onInterrupt}
      onLostPointerCapture={onInterrupt}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {preview && (
        <svg className="pen-preview" aria-hidden="true">
          <path
            data-testid="pen-preview"
            d={preview}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
