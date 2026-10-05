/**
 * The Pen tool (`pen.*`).
 *
 * A screen-space layer over the board, like the Shape and Arrow tools: press
 * and drag to draw. Pointer events are captured (`setPointerCapture`, with the
 * Story 3 pattern as the jsdom fallback) and coalesced samples are recorded as
 * *world* points through the current camera — so the same gesture produces the
 * same geometry at any zoom, and what a remote participant draws is exactly
 * what they saw.
 *
 * While drawing, only a local preview moves: an SVG polyline fed from
 * `requestAnimationFrame`-batched state, never a document write. On release
 * the recording is simplified with `STROKE_SIMPLIFY_TOLERANCE_PX / zoom` —
 * every drawn point lands within one *screen* pixel of the committed stroke
 * (`pen.smooth`) — and `createStroke` writes it once. Escape mid-stroke
 * unmounts this component: the listeners go and nothing is committed
 * (`pen.cancel`). A drag longer than `STROKE_MAX_POINTS` commits the first
 * part and continues from its last point, so one endless gesture becomes
 * consecutive seamlessly-joined strokes (`pen.long_stroke`).
 *
 * Unlike the sticky and shape tools the pen stays active after a stroke: a
 * drawing session is the point, so `toolCreated` is deliberately not called.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

export interface PenToolProps {
  doc: Y.Doc;
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  identityId: string;
  onUndoBoundary?(): void;
}

interface Drag {
  pointerId: number;
  /** The recording, in world units. */
  points: Point[];
  /** A pending rAF preview flush, or null when none is scheduled. */
  frame: number | null;
}

export function PenTool(props: PenToolProps) {
  const { doc, camera, color, thickness, identityId, onUndoBoundary } = props;
  // Live values for the window handlers, captured at render.
  const live = useRef({ doc, camera, color, thickness, identityId, onUndoBoundary });
  live.current = { doc, camera, color, thickness, identityId, onUndoBoundary };
  const drawing = useRef<Drag | null>(null);
  // The preview lives in component state only: `pen.preview` promises the
  // document stays untouched while drawing.
  const [preview, setPreview] = useState<readonly Point[] | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  /** Commit one stroke as its own undo group (boundary before and after). */
  const commit = useCallback(
    (points: readonly Point[]): void => {
      const l = live.current;
      l.onUndoBoundary?.();
      createStroke(l.doc, { points, color: l.color, thickness: l.thickness }, l.identityId);
      l.onUndoBoundary?.();
    },
    [],
  );

  /** Batch preview updates into at most one per animation frame. */
  const flushPreview = useCallback((d: Drag): void => {
    if (d.frame !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      setPreview(d.points.slice());
      return;
    }
    d.frame = requestAnimationFrame(() => {
      d.frame = null;
      setPreview(d.points.slice());
    });
  }, []);

  const appendWorld = useCallback(
    (point: Point): void => {
      const d = drawing.current;
      if (!d) return;
      const last = d.points[d.points.length - 1];
      if (last && last.x === point.x && last.y === point.y) return;
      d.points.push(point);
      flushPreview(d);
      if (d.points.length >= STROKE_MAX_POINTS) {
        // The recording is full: commit it now and carry the last point over as
        // the first point of the next stroke, so the join is exact.
        const recorded = d.points;
        const zoom = live.current.camera.zoom || 1;
        commit(simplify(recorded, STROKE_SIMPLIFY_TOLERANCE_PX / zoom));
        d.points = [recorded[recorded.length - 1]];
      }
    },
    [commit, flushPreview],
  );

  // The window handlers close over `detach` and `detach` must remove exactly
  // those handlers — a stable pair wired through a ref, because each half is
  // defined after the other.
  const handlers = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: (event: PointerEvent) => void;
  } | null>(null);

  const detach = useCallback((): void => {
    const h = handlers.current;
    if (!h) return;
    window.removeEventListener('pointermove', h.move);
    window.removeEventListener('pointerup', h.up);
    window.removeEventListener('pointercancel', h.cancel);
  }, []);

  const finish = useCallback((): void => {
    const d = drawing.current;
    if (!d) return;
    drawing.current = null;
    if (d.frame !== null) cancelAnimationFrame(d.frame);
    setPreview(null);
    detach();
    if (d.points.length === 0) return;
    const zoom = live.current.camera.zoom || 1;
    const first = d.points[0];
    const last = d.points[d.points.length - 1];
    const travel = Math.hypot((last.x - first.x) * zoom, (last.y - first.y) * zoom);
    // Below the drag threshold this was a click: a single-point dot.
    const simplified =
      travel < DRAG_THRESHOLD_PX
        ? [first]
        : simplify(d.points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    if (simplified.length === 0) return;
    commit(simplified);
  }, [commit, detach]);

  // All three callbacks keep a stable identity (their dependencies do too), so
  // adding and removing them by reference is enough.
  const onWindowMove = useCallback(
    (event: PointerEvent): void => {
      const d = drawing.current;
      if (!d || event.pointerId !== d.pointerId) return;
      const coalesced =
        typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
      const samples = coalesced.length > 0 ? coalesced : [event];
      const cameraNow = live.current.camera;
      for (const sample of samples) {
        appendWorld(screenToWorld(cameraNow, { x: sample.clientX, y: sample.clientY }));
      }
    },
    [appendWorld],
  );

  const onWindowUp = useCallback(
    (event: PointerEvent): void => {
      const d = drawing.current;
      if (!d || event.pointerId !== d.pointerId) return;
      finish();
    },
    [finish],
  );

  const onWindowCancel = useCallback(
    (event: PointerEvent): void => {
      const d = drawing.current;
      if (!d || event.pointerId !== d.pointerId) return;
      finish();
    },
    [finish],
  );

  handlers.current = { move: onWindowMove, up: onWindowUp, cancel: onWindowCancel };

  // Unmount mid-stroke (Escape, tool switch): drop the recording without
  // committing — `pen.cancel` — and leave no listeners or frames behind.
  const stopRef = useRef<() => void>(() => undefined);
  stopRef.current = () => {
    const d = drawing.current;
    if (d?.frame != null) cancelAnimationFrame(d.frame);
    drawing.current = null;
    detach();
  };
  useEffect(() => () => stopRef.current(), [detach]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      if (drawing.current) return; // one stroke per pen
      event.stopPropagation();
      const start = screenToWorld(live.current.camera, {
        x: event.clientX,
        y: event.clientY,
      });
      drawing.current = { pointerId: event.pointerId, points: [start], frame: null };
      setCursor({ x: event.clientX, y: event.clientY });
      const target = event.currentTarget;
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // jsdom: the window listeners below cover the fallback.
      }
      window.addEventListener('pointermove', onWindowMove);
      window.addEventListener('pointerup', onWindowUp);
      window.addEventListener('pointercancel', onWindowCancel);
    },
    [onWindowCancel, onWindowMove, onWindowUp],
  );

  // A release that skipped both window listeners (a capture the browser
  // silently lost) still finishes the stroke.
  const onLostPointerCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      const d = drawing.current;
      if (d && event.pointerId === d.pointerId) finish();
    },
    [finish],
  );

  const onLayerMove = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    setCursor({ x: event.clientX, y: event.clientY });
  }, []);

  const zoom = camera.zoom || 1;
  const previewPath =
    preview && preview.length > 0
      ? smoothPath(preview.map((p) => worldToScreen(camera, p)))
      : '';

  return (
    <div
      data-tool-layer="pen"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 4,
        background: 'transparent',
        pointerEvents: 'auto',
        cursor: 'none', // the crosshair dot below is the cursor
        touchAction: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onLayerMove}
      onPointerLeave={() => setCursor(null)}
      onLostPointerCapture={onLostPointerCapture}
    >
      {previewPath ? (
        <svg
          data-testid="pen-preview"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <path
            d={previewPath}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {cursor ? (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'absolute',
            left: cursor.x,
            top: cursor.y,
            width: Math.max(2, PEN_THICKNESS_WORLD[thickness] * zoom),
            height: Math.max(2, PEN_THICKNESS_WORLD[thickness] * zoom),
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: PEN_COLORS[color],
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}
