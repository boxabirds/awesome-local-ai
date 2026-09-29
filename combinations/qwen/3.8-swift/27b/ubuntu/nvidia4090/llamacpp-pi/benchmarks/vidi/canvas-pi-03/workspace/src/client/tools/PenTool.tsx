/**
 * Story 11: the pen tool (pen.draw, pen.long_stroke, pen.dot, pen.navigation,
 * pen.cursor).
 *
 * A full-viewport fixed layer that captures pointer input while the tool is
 * active:
 * - press-and-drag collects raw world points (coalesced events included) and
 *   renders a LIVE preview path in screen space (rAF-throttled) — the line
 *   follows the pointer immediately, unsimplified (pen.draw);
 * - on release the raw points are simplified (RDP, tolerance
 *   STROKE_SIMPLIFY_TOLERANCE_PX / zoom) and committed with createStroke —
 *   one transaction per part, one undo step each (pen.long_stroke);
 * - when the raw count reaches STROKE_MAX_POINTS mid-drag the stroke splits
 *   into seamless parts (shared join point) that are committed as they fill,
 *   and drawing continues with the rest (pen.long_stroke);
 * - a press that releases with less than DRAG_THRESHOLD_PX of movement
 *   commits a single point → a round dot; a pointercancel (tab switch)
 *   commits the points drawn so far (pen.dot, pen.error_paths);
 * - the native cursor is hidden and a custom round dot sized
 *   PEN_THICKNESS_WORLD[thickness] × zoom tracks the pointer (pen.cursor);
 * - wheel / pinch events are forwarded to the camera handler, so pan and
 *   zoom still work over the layer (pen.navigation);
 * - Escape deactivates the tool via the global useBoardKeys (back to
 *   Select); the tool STAYS active after a commit (keep sketching).
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from 'src/shared/config';
import { simplify, smoothPath } from 'src/shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from 'src/shared/objects/stroke';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  undo: UndoController;
  /** The camera's wheel handler — forwarded so navigation works over the layer (pen.navigation). */
  onWheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
}

export function PenTool(props: PenToolProps): JSX.Element {
  const layerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const rawRef = useRef<Point[]>([]); // current raw world points
  const startRef = useRef<{ client: Point } | null>(null); // press start (local coords)
  const maxMovedRef = useRef(0); // furthest raw point from the press point
  const rafRef = useRef(0);
  const renderedRef = useRef(false); // a preview frame exists for this stroke
  const lastScaleRef = useRef(1);

  const [preview, setPreview] = useState<{ d: string; width: number } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  // ---------- coordinate helpers (always read the live camera) ----------
  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const toWorld = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(propsRef.current.camera, toLocal(e));

  // ---------- preview ----------
  const renderPreview = () => {
    const pts = rawRef.current;
    if (pts.length === 0) {
      setPreview(null);
      return;
    }
    const cam = propsRef.current.camera;
    const screenPts = pts.map((p) => worldToScreen(cam, p));
    setPreview({
      d: smoothPath(screenPts),
      width: PEN_THICKNESS_WORLD[propsRef.current.thickness] * cam.zoom,
    });
  };
  const schedulePreview = () => {
    // The FIRST frame renders synchronously so the line appears on the press
    // itself; further moves are rAF-throttled (pen.draw).
    if (!renderedRef.current) {
      renderedRef.current = true;
      renderPreview();
      return;
    }
    if (rafRef.current !== 0) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderPreview();
    });
  };
  useEffect(
    () => () => {
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // ---------- commit ----------
  const commitPart = (pts: Point[]) => {
    if (pts.length === 0) return;
    const p = propsRef.current;
    // Simplify in world units with the screen tolerance scaled by zoom
    // (pen.smooth); a single point (dot) passes through unsimplified.
    const simplified =
      pts.length > 1 ? simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / p.camera.zoom) : pts;
    p.undo.boundary();
    createStroke(p.doc, { points: simplified, color: p.color, thickness: p.thickness }, p.identityId);
    p.undo.boundary();
  };

  const finishStroke = () => {
    const start = startRef.current;
    startRef.current = null;
    const pts = rawRef.current;
    const maxMoved = maxMovedRef.current;
    rawRef.current = [];
    maxMovedRef.current = 0;
    if (!start) return;
    // A stroke whose path never strayed 4 px from the press point is a dot
    // (pen.dot). The MAX deviation (not the release position) is used so
    // closed shapes, which end where they started, stay lines. An
    // interrupted stroke keeps the points drawn so far (pen.error_paths).
    commitPart(maxMoved < DRAG_THRESHOLD_PX ? [pts[0]] : pts);
    renderedRef.current = false;
    setPreview(null);
  };

  // ---------- pointer handlers ----------
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    layerRef.current?.setPointerCapture(e.pointerId);
    const local = toLocal(e);
    rawRef.current = [toWorld(e)];
    startRef.current = { client: local };
    maxMovedRef.current = 0;
    schedulePreview();
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const local = toLocal(e);
    setCursor(local);
    if (!startRef.current) return;
    const dev = Math.hypot(local.x - startRef.current.client.x, local.y - startRef.current.client.y);
    if (dev > maxMovedRef.current) maxMovedRef.current = dev;
    // Include coalesced intermediate events for smoothness (pen.draw).
    const events: Array<{ clientX: number; clientY: number }> =
      typeof (e as unknown as { getCoalescedEvents?: () => Array<{ clientX: number; clientY: number }> }).getCoalescedEvents === 'function'
        ? (e as unknown as { getCoalescedEvents: () => Array<{ clientX: number; clientY: number }> }).getCoalescedEvents()
        : [e];
    for (const ev of events) rawRef.current.push(toWorld(ev));
    // Long stroke: commit a full part as soon as it fills, keep drawing from
    // the shared join point (pen.long_stroke).
    while (rawRef.current.length >= STROKE_MAX_POINTS) {
      const part = rawRef.current.slice(0, STROKE_MAX_POINTS);
      const join = part[part.length - 1];
      commitPart(part);
      rawRef.current = [join];
    }
    schedulePreview();
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!startRef.current) return;
    layerRef.current?.releasePointerCapture?.(e.pointerId);
    rawRef.current.push(toWorld(e)); // the release point ends the line
    finishStroke();
  };

  const handlePointerCancel = () => {
    if (!startRef.current) return;
    finishStroke();
  };

  // ---------- navigation over the layer (native, non-passive) ----------
  // Mirrors the BoardViewport's wheel/gesture handling so pan and zoom keep
  // working over the layer (pen.navigation).
  useEffect(() => {
    const el = layerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      propsRef.current.onWheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScaleRef.current = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      if (scale === 0) return;
      const ratio = scale / lastScaleRef.current;
      lastScaleRef.current = scale;
      propsRef.current.onWheel({
        deltaX: 0,
        deltaY: -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: { x: 0, y: 0 },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart as EventListener, {
      passive: false,
    } as AddEventListenerOptions);
    el.addEventListener('gesturechange', onGestureChange as EventListener, {
      passive: false,
    } as AddEventListenerOptions);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, []);

  const size = PEN_THICKNESS_WORLD[props.thickness] * props.camera.zoom;

  return (
    <>
      <div
        ref={layerRef}
        data-testid="pen-tool-layer"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          cursor: 'none',
          touchAction: 'none',
        }}
      />
      {cursor && (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'fixed',
            left: cursor.x - size / 2,
            top: cursor.y - size / 2,
            width: size,
            height: size,
            borderRadius: '50%',
            backgroundColor: PEN_COLORS[props.color],
            opacity: 0.85,
            pointerEvents: 'none',
            zIndex: 1001,
          }}
        />
      )}
      {preview && (
        <svg
          data-testid="pen-preview"
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: 1000,
          }}
        >
          <path
            data-testid="pen-preview-path"
            d={preview.d}
            fill="none"
            stroke={PEN_COLORS[props.color]}
            strokeWidth={preview.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </>
  );
}
