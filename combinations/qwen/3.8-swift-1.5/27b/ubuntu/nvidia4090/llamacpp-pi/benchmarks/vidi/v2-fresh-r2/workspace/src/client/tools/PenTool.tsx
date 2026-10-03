/**
 * Pen tool overlay (story 11, pen.tool).
 *
 * Full-screen capture layer while the Pen tool is active:
 * - drag → captures coalesced pointer points, draws a local SVG preview
 *   (never written to the Y.Doc), commits a stroke on release
 * - click (no movement) → a round dot
 * - pointercancel / lostpointercapture → commits points so far
 * - STROKE_MAX_POINTS reached → commits the part and restarts
 *
 * The pen stays active after each stroke (pen.stay_active).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
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
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { smoothPath, simplify } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';

interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Call after each commit to mark an undo boundary. */
  onCommit?: () => void;
  /** Forward wheel events to the camera (pen.navigation). */
  onWheel?: (e: React.WheelEvent<HTMLDivElement>) => void;
}

interface DrawState {
  points: Point[];
  startScreen: { x: number; y: number };
}

export function PenTool({ camera, color, thickness, doc, identityId, onCommit, onWheel }: PenToolProps): JSX.Element {
  const [preview, setPreview] = useState<string | null>(null);
  const drawingRef = useRef<DrawState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingPointsRef = useRef<Point[]>([]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point =>
      screenToWorld(camera, { x: clientX, y: clientY }),
    [camera],
  );

  const schedulePreview = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pts = pendingPointsRef.current;
      if (pts.length === 0) {
        setPreview(null);
        return;
      }
      // Convert to screen space for the preview
      const screenPts = pts.map((p) => ({
        x: (p.x - camera.x) * camera.zoom,
        y: (p.y - camera.y) * camera.zoom,
      }));
      setPreview(smoothPath(screenPts));
    });
  }, [camera]);

  const commitPoints = useCallback(
    (pts: Point[]) => {
      if (pts.length === 0) return;
      // Check if it's a dot (single point or all same point)
      const isDot =
        pts.length === 1 ||
        (pts.length > 1 && pts.every((p) => p.x === pts[0].x && p.y === pts[0].y));

      if (isDot) {
        const id = createStroke(doc, { points: [pts[0]], color, thickness }, identityId);
        if (id) onCommit?.();
        return;
      }

      // Simplify with tolerance scaled by zoom
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom;
      const simplified = simplify(pts, tolerance);
      const id = createStroke(doc, { points: simplified, color, thickness }, identityId);
      if (id) onCommit?.();
    },
    [doc, color, thickness, identityId, camera.zoom, onCommit],
  );

  const finishStroke = useCallback(() => {
    const state = drawingRef.current;
    if (!state) return;
    drawingRef.current = null;
    pendingPointsRef.current = [];
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPreview(null);

    // Check if it was a click (no movement)
    const lastPt = state.points[state.points.length - 1];
    if (lastPt) {
      const dx = lastPt.x - state.points[0].x;
      const dy = lastPt.y - state.points[0].y;
      const screenDist = Math.hypot(dx, dy) * camera.zoom;
      if (screenDist < DRAG_THRESHOLD_PX) {
        // Dot
        commitPoints([state.points[0]]);
        return;
      }
    }
    commitPoints(state.points);
  }, [camera.zoom, commitPoints]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const p = toWorld(e.clientX, e.clientY);
      drawingRef.current = {
        points: [p],
        startScreen: { x: e.clientX, y: e.clientY },
      };
      pendingPointsRef.current = [p];
      schedulePreview();
    },
    [toWorld, schedulePreview],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const state = drawingRef.current;
      if (!state) return;

      // Use coalesced events when available
      const nativeEvent = e.nativeEvent as PointerEvent;
      const events: PointerEvent[] =
        typeof nativeEvent.getCoalescedEvents === 'function' && nativeEvent.getCoalescedEvents().length > 0
          ? nativeEvent.getCoalescedEvents()
          : [nativeEvent];

      for (const ev of events) {
        const p = toWorld(ev.clientX, ev.clientY);
        state.points.push(p);
        pendingPointsRef.current.push(p);
      }

      // Check if we hit the point limit
      if (state.points.length >= STROKE_MAX_POINTS) {
        // Commit the current part and restart from the last point
        const part = state.points.slice(0, STROKE_MAX_POINTS);
        const lastPt = part[part.length - 1];
        commitPoints(part);
        state.points = [lastPt];
        pendingPointsRef.current = [lastPt];
      }

      schedulePreview();
    },
    [toWorld, schedulePreview, commitPoints],
  );

  const onPointerUp = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  const onPointerCancel = useCallback(() => {
    // Interrupted stroke: commit points so far (pen.interrupted)
    finishStroke();
  }, [finishStroke]);

  const onLostPointerCapture = useCallback(() => {
    // Pointer capture lost: commit points so far (pen.interrupted)
    finishStroke();
  }, [finishStroke]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const cursorSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  return (
    <div
      data-testid="pen-tool"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onWheel={onWheel}
      style={{
        position: 'fixed',
        inset: 0,
        cursor: 'none',
        zIndex: 5,
        touchAction: 'none',
      }}
    >
      {/* Round cursor preview */}
      <div
        data-testid="pen-cursor"
        aria-hidden="true"
        style={{
          position: 'fixed',
          width: cursorSize,
          height: cursorSize,
          borderRadius: '50%',
          border: `1.5px solid ${PEN_COLORS[color]}`,
          background: 'transparent',
          pointerEvents: 'none',
          top: -cursorSize / 2,
          left: -cursorSize / 2,
        }}
      />
      {/* Stroke preview (screen space) */}
      {preview && (
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
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
