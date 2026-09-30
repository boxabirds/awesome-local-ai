/**
 * Pen tool (story 11, pen.tool).
 *
 * Captures coalesced pointer points into a LOCAL, never-synced preview
 * overlay; on release (or cancel, or reaching STROKE_MAX_POINTS) it
 * simplifies the points with Ramer–Douglas–Peucker at a zoom-scaled
 * tolerance and commits one stroke object via `createStroke` (one
 * LOCAL_ORIGIN transaction, synced to others by story 3).
 *
 * - The in-progress preview is a screen-space SVG path redrawn once per
 *   animation frame; it is never written to the document, so nobody else
 *   sees a stroke while it is being drawn (pen.share).
 * - A click without movement commits a single-point dot (pen.dot).
 * - `pointercancel` / `lostpointercapture` finish the stroke with the points
 *   drawn so far instead of discarding it (pen.interrupted).
 * - At STROKE_MAX_POINTS recorded points the current part is committed and
 *   drawing continues as a new stroke from the same last point
 *   (pen.long_stroke).
 * - The Pen stays active after each stroke; Escape / other tools switch
 *   (handled by useActiveTool) (pen.stay_active).
 * - Wheel/trackpad events are forwarded to the board's camera handler, so
 *   scrolling pans and Ctrl/Cmd+scroll zooms while the Pen is active
 *   (pen.navigation); pointer drags draw and never pan or move objects.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';

const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 120;

/** Round pen cursor (data URI) sized to the thickness at the current zoom. */
function penCursor(diameterPx: number): string {
  const s = Math.max(4, Math.min(64, Math.round(diameterPx)));
  const c = s / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${s}' height='${s}'>` +
    `<circle cx='${c}' cy='${c}' r='${Math.max(1, c - 0.75)}' fill='rgba(0,0,0,0.30)' stroke='white' stroke-width='1.5'/>` +
    `</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
}

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Story 8: close the undo capture window after each committed stroke. */
  onBoundary?: () => void;
  /**
   * Forward wheel events to the board camera (story 1 navigation), so
   * scrolling pans and Ctrl/Cmd+scroll zooms while the Pen overlay is up.
   */
  onWheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
}

export function PenTool({ camera, color, thickness, doc, identityId, onBoundary, onWheel }: PenToolProps): ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);

  const [previewD, setPreviewD] = useState<string | null>(null);

  // Gesture state (refs: pointer handlers must stay fast and stable).
  const pointsRef = useRef<Point[]>([]);
  const startScreenRef = useRef<Point | null>(null);
  // Max distance of any recorded point from the start point: a closed loop
  // ends where it started, so the start→end displacement would be 0.
  const maxMoveRef = useRef(0);
  const drawingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);

  // Latest props for the rAF callback and native listeners.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const docRef = useRef(doc);
  docRef.current = doc;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;
  const onBoundaryRef = useRef(onBoundary);
  onBoundaryRef.current = onBoundary;
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;

  const toScreen = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = overlayRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  }, []);

  /** Redraw the local preview from the recorded world points. */
  const renderPreview = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) {
      setPreviewD(null);
      return;
    }
    const screen = pts.map((p) => worldToScreen(cameraRef.current, p));
    setPreviewD(smoothPath(screen));
  }, []);

  /** Queue a preview redraw once per animation frame. */
  const schedulePreview = useCallback(() => {
    dirtyRef.current = true;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      renderPreview();
    });
  }, [renderPreview]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /** Simplify (at the drawing zoom) and commit one stroke; null → silent. */
  const commitPart = useCallback((pts: Point[]) => {
    if (pts.length === 0) return;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cameraRef.current.zoom;
    const simplified = simplify(pts, tolerance);
    const id = createStroke(docRef.current, { points: simplified, color: colorRef.current, thickness: thicknessRef.current }, identityRef.current);
    if (id !== null) {
      onBoundaryRef.current?.();
    }
  }, []);

  const endDrawing = useCallback(() => {
    drawingRef.current = false;
    startScreenRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button != null && e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const screen = toScreen(e);
      drawingRef.current = true;
      startScreenRef.current = screen;
      maxMoveRef.current = 0;
      pointsRef.current = [screenToWorld(cameraRef.current, screen)];
      dirtyRef.current = true;
      renderPreview();
      try {
        overlayRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // jsdom doesn't support pointer capture
      }
    },
    [toScreen, renderPreview]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      // Coalesced events keep the line faithful at high pointer rates.
      const native = e.nativeEvent as PointerEvent;
      const events: Array<{ clientX: number; clientY: number }> =
        typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
          ? native.getCoalescedEvents()
          : [native];
      const start = startScreenRef.current;
      for (const ev of events) {
        const s = toScreen(ev);
        if (start) {
          const d = Math.hypot(s.x - start.x, s.y - start.y);
          if (d > maxMoveRef.current) maxMoveRef.current = d;
        }
        pointsRef.current.push(screenToWorld(cameraRef.current, s));
      }
      // Very long strokes: commit the full part and continue from its last
      // point so the two strokes join with no visible gap.
      while (pointsRef.current.length > STROKE_MAX_POINTS) {
        const part = pointsRef.current.slice(0, STROKE_MAX_POINTS);
        pointsRef.current = [part[part.length - 1], ...pointsRef.current.slice(STROKE_MAX_POINTS)];
        commitPart(part);
      }
      schedulePreview();
    },
    [toScreen, commitPart, schedulePreview]
  );

  /** pointerup: a click without movement is a dot; otherwise finish the stroke. */
  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const moved = maxMoveRef.current;
      endDrawing();
      const pts = pointsRef.current;
      pointsRef.current = [];
      dirtyRef.current = false;
      setPreviewD(null);
      try {
        overlayRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      if (pts.length === 0) return;
      if (moved < DRAG_THRESHOLD_PX) {
        commitPart([pts[0]]); // dot: single point
      } else {
        commitPart(pts);
      }
    },
    [endDrawing, toScreen, commitPart]
  );

  /** Cancel / lost capture: keep the points drawn so far (pen.interrupted). */
  const handlePointerCancel = useCallback(() => {
    if (!drawingRef.current) return;
    endDrawing();
    const pts = pointsRef.current;
    pointsRef.current = [];
    dirtyRef.current = false;
    setPreviewD(null);
    if (pts.length > 0) commitPart(pts);
  }, [endDrawing, commitPart]);

  // Forward wheel (and Safari pinch gestures) to the board camera so
  // navigation keeps working while the Pen overlay is up.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= WHEEL_LINE_DELTA_PX;
        dy *= WHEEL_LINE_DELTA_PX;
      } else if (e.deltaMode === 2) {
        dx *= WHEEL_PAGE_DELTA_PX;
        dy *= WHEEL_PAGE_DELTA_PX;
      }
      const rect = el.getBoundingClientRect();
      onWheelRef.current?.({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: penCursor(thicknessWorld * camera.zoom),
        zIndex: 5,
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      <svg
        data-testid="pen-preview"
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {previewD !== null && (
          <path
            d={previewD}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={Math.max(1, thicknessWorld * camera.zoom)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </div>
  );
}
