/**
 * PenTool (story 11): captures pointer points, draws a local preview,
 * and commits strokes on finish/cancel/limit.
 *
 * - pointerdown: capture pointer, start recording world points.
 * - pointermove: append coalesced events to the point list; redraw preview per rAF.
 * - STROKE_MAX_POINTS reached: simplify + commit the part, restart from last point.
 * - pointerup: if movement < DRAG_THRESHOLD_PX → dot; else simplify + commit.
 * - pointercancel / lostpointercapture: commit points so far (interrupted stroke kept).
 * - Preview is a local SVG overlay, never written to the Y.Doc.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import type { Point } from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import type { Camera } from '../canvas/camera';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import {
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  onCommit?(): void;
  /** Wheel handler (pan/zoom) so scrolling works while Pen is active. */
  onWheel?(e: WheelEvent): void;
}

interface DrawingState {
  points: Point[];
  startScreen: Point;
}

export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness, doc, identityId, onCommit, onWheel } = props;
  const [previewPath, setPreviewPath] = useState<string>('');

  const camRef = useRef(camera);
  camRef.current = camera;
  const drawingRef = useRef<DrawingState | null>(null);
  const rafRef = useRef<number>(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const docRef = useRef(doc);
  docRef.current = doc;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];

  // Redraw preview once per animation frame
  const schedulePreview = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const d = drawingRef.current;
      if (!d || d.points.length === 0) {
        setPreviewPath('');
        return;
      }
      // Convert world points to screen space for the preview
      const cam = camRef.current;
      const screenPts = d.points.map((p) => ({
        x: (p.x - cam.x) * cam.zoom,
        y: (p.y - cam.y) * cam.zoom,
      }));
      setPreviewPath(smoothPath(screenPts));
    });
  }, []);

  const commitPoints = useCallback((pts: Point[]) => {
    if (pts.length === 0) return;
    const cam = camRef.current;
    const tol = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
    const simplified = simplify(pts, tol);
    const id = createStroke(docRef.current, {
      points: simplified,
      color: colorRef.current,
      thickness: thicknessRef.current,
    }, identityId);
    if (id) {
      // Stop capturing undo (one undo step per stroke)
      const undoManager = (docRef.current as any).undoManager;
      if (undoManager) undoManager.stopCapturing();
      onCommitRef.current?.();
    }
  }, [identityId]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch { /* jsdom */ }

    const screenPt = { x: e.clientX, y: e.clientY };
    const worldPt = screenToWorld(camRef.current, screenPt);
    const state: DrawingState = { points: [worldPt], startScreen: screenPt };
    drawingRef.current = state;
    schedulePreview();
  }, [schedulePreview]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d) return;

    // Use coalesced events when available
    let events: PointerEvent[];
    if (typeof e.nativeEvent.getCoalescedEvents === 'function' && e.nativeEvent.getCoalescedEvents().length > 0) {
      events = e.nativeEvent.getCoalescedEvents();
    } else {
      events = [e.nativeEvent];
    }

    for (const ev of events) {
      const sp = { x: ev.clientX, y: ev.clientY };
      const wp = screenToWorld(camRef.current, sp);
      d.points.push(wp);
    }

    // Check if we've hit the max points limit
    if (d.points.length >= STROKE_MAX_POINTS) {
      // Commit the current part and restart from the last point
      commitPoints(d.points);
      const lastPt = d.points[d.points.length - 1];
      d.points = [lastPt];
    }

    schedulePreview();
  }, [commitPoints, schedulePreview]);

  const finishStroke = useCallback((e?: React.PointerEvent<HTMLDivElement>) => {
    const d = drawingRef.current;
    if (!d) return;
    drawingRef.current = null;
    setPreviewPath('');
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    if (d.points.length === 0) return;

    // Check if it was a click (no movement)
    if (e) {
      const dx = e.clientX - d.startScreen.x;
      const dy = e.clientY - d.startScreen.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        // Single point dot
        commitPoints(d.points);
        return;
      }
    }

    commitPoints(d.points);
  }, [commitPoints]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    finishStroke(e);
  }, [finishStroke]);

  const handlePointerCancel = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  const handleLostPointerCapture = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Wheel handler: forward to the camera (pan/zoom while Pen is active)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !onWheel) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      onWheel(e);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [onWheel]);

  // Round cursor sized to thickness * zoom
  const cursorSize = thicknessWorld * camRef.current.zoom;

  return (
    <div
      ref={overlayRef}
      data-vidi6="pen-tool"
      className="tool-overlay"
      style={{
        cursor: `circle ${cursorSize / 2}px ${cursorSize / 2}px, crosshair`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      {previewPath && (
        <svg
          data-vidi6="pen-preview"
          className="pen-preview-svg"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <path
            d={previewPath}
            fill="none"
            stroke={color}
            strokeWidth={thicknessWorld * camRef.current.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
