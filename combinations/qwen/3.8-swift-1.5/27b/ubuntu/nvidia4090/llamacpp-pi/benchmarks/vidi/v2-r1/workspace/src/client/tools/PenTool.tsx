/**
 * Story 11: PenTool — freehand drawing overlay.
 *
 * Gesture state machine (local only; nothing is persisted until commit):
 *   Idle → pointerdown → Drawing
 *   Drawing → pointermove: append coalesced world points
 *   Drawing → STROKE_MAX_POINTS reached: commit the part, restart at the
 *             shared last point (no visible gap)
 *   Drawing → pointerup: commit the stroke (or a dot when the movement is
 *             below DRAG_THRESHOLD_PX)
 *   Drawing → pointercancel / lostpointercapture: commit the points so far
 *   (PRD pen.draw, pen.dot, pen.long_stroke, pen.interrupted)
 *
 * The in-progress stroke is a LOCAL screen-space SVG preview that is never
 * written to the Y.Doc, so others do not see a stroke while it is being
 * drawn (PRD pen.share). On finish, one createStroke transaction (one undo
 * step) is committed in the chosen colour and thickness.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  PEN_COLORS, PEN_THICKNESS_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX, STROKE_MAX_POINTS, DRAG_THRESHOLD_PX,
  WHEEL_DELTA_LINE, WHEEL_DELTA_PAGE,
} from '@shared/config';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { simplify, smoothPath } from '@shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '@shared/objects/stroke';
import type { Point } from '@shared/geometry';

interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Called after each committed stroke (story 8 undo boundary). */
  onCommitted?: () => void;
  /**
   * Camera wheel handler. The overlay sits OUTSIDE the board viewport
   * (screen space), so the viewport's own wheel listener never sees events
   * over it: the board must still pan/zoom on scroll while the pen is
   * active (PRD pen.navigation).
   */
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
}

export function PenTool({ camera, color, thickness, doc, identityId, onCommitted, wheel }: PenToolProps) {
  const [previewD, setPreviewD] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const draggingRef = useRef(false);
  const startScreenRef = useRef<Point | null>(null);
  const rafRef = useRef(0);

  // Always-current refs so gesture handlers never see stale values.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const onCommittedRef = useRef(onCommitted);
  onCommittedRef.current = onCommitted;

  const renderPreview = useCallback(() => {
    rafRef.current = 0;
    const pts = pointsRef.current;
    if (pts.length === 0) {
      setPreviewD(null);
      return;
    }
    // Screen-space preview path (the overlay lives in screen space).
    const screenPts = pts.map((p) => worldToScreen(cameraRef.current, p));
    setPreviewD(smoothPath(screenPts));
  }, []);

  const schedulePreview = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(renderPreview);
    }
  }, [renderPreview]);

  const commitPart = useCallback((pts: Point[]) => {
    if (pts.length === 0) return;
    // Smoothing stays faithful: 1 screen pixel at the drawing zoom.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cameraRef.current.zoom;
    const simplified = simplify(pts, tolerance);
    const id = createStroke(
      doc,
      { points: simplified, color: colorRef.current, thickness: thicknessRef.current },
      identityId,
    );
    if (id !== null) {
      // Each finished stroke (and each part of a split long stroke) is one
      // undo step (PRD constraints).
      onCommittedRef.current?.();
    }
  }, [doc, identityId]);

  const finish = useCallback(() => {
    draggingRef.current = false;
    startScreenRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const pts = pointsRef.current;
    pointsRef.current = [];
    setPreviewD(null);
    if (pts.length === 0) return;
    commitPart(pts);
  }, [commitPart]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button) return;
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // jsdom doesn't support setPointerCapture
    }
    draggingRef.current = true;
    const screen = { x: e.clientX, y: e.clientY };
    startScreenRef.current = screen;
    pointsRef.current = [screenToWorld(cameraRef.current, screen)];
    schedulePreview();
  }, [schedulePreview]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    // Use coalesced events when available so fast pointer moves are not
    // lost (the line follows the pointer at least once per frame).
    const native = e.nativeEvent as PointerEvent;
    let events: Array<{ clientX: number; clientY: number }> = [native];
    if (typeof native.getCoalescedEvents === 'function') {
      const coalesced = native.getCoalescedEvents();
      if (coalesced.length > 0) events = coalesced;
    }
    for (const ev of events) {
      const world = screenToWorld(cameraRef.current, { x: ev.clientX, y: ev.clientY });
      pointsRef.current.push(world);
      // Very long strokes: finish the part and continue from the shared
      // last point (PRD pen.long_stroke).
      if (pointsRef.current.length >= STROKE_MAX_POINTS) {
        const part = pointsRef.current.slice(0, STROKE_MAX_POINTS);
        const join = part[part.length - 1];
        pointsRef.current = [join];
        commitPart(part);
      }
    }
    schedulePreview();
  }, [commitPart, schedulePreview]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const start = startScreenRef.current;
    const end = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
    startScreenRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const pts = pointsRef.current;
    pointsRef.current = [];
    setPreviewD(null);
    if (pts.length === 0) return;
    // A click without movement draws a round dot (PRD pen.dot).
    const moved = start ? Math.hypot(end.x - start.x, end.y - start.y) : 0;
    if (moved < DRAG_THRESHOLD_PX) {
      commitPart([pts[0]]);
    } else {
      commitPart(pts);
    }
  }, [commitPart]);

  // An interrupted drag (pointercancel / lost capture) keeps the points
  // drawn so far (PRD pen.interrupted).
  const handlePointerCancel = useCallback(() => {
    if (!draggingRef.current) return;
    finish();
  }, [finish]);

  // Clean up a pending preview frame on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, []);

  // Wheel over the overlay pans/zooms the board (PRD pen.navigation).
  const wheelRef = useRef(wheel);
  wheelRef.current = wheel;
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !wheel) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) { // DeltaMode.LINE
        dx *= WHEEL_DELTA_LINE;
        dy *= WHEEL_DELTA_LINE;
      } else if (e.deltaMode === 2) { // DeltaMode.PAGE
        dx *= WHEEL_DELTA_PAGE;
        dy *= WHEEL_DELTA_PAGE;
      }
      const rect = el.getBoundingClientRect();
      wheelRef.current?.({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [wheel]);

  // Round cursor sized to the current thickness at the current zoom
  // (PRD structure: "Round pointer preview sized to the thickness at the
  // current zoom").
  const thicknessPx = PEN_THICKNESS_WORLD[thickness];
  const size = Math.max(2, Math.round(thicknessPx * camera.zoom));
  const cursorR = Math.max(0.5, size / 2 - 1);
  const cursorSvg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${cursorR}" fill="rgba(33,33,33,0.4)" stroke="white" stroke-width="1"/>` +
    `</svg>`,
  );

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        touchAction: 'none',
        cursor: `url("data:image/svg+xml,${cursorSvg}") ${size / 2} ${size / 2}, crosshair`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
    >
      {previewD !== null && (
        <svg
          data-testid="pen-preview-svg"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <path
            data-testid="pen-preview"
            d={previewD}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={thicknessPx * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
