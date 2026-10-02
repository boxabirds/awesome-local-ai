// src/client/tools/PenTool.tsx
// Pen tool: captures pointer points, draws local preview, commits strokes on finish.

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import {
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  PEN_COLORS,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import type { Point as WorldPoint } from '../../shared/geometry';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  /** Creates a stroke from world-space points. Returns id or null. */
  create: (points: WorldPoint[]) => string | null;
  /** Forward wheel events for pan/zoom while pen is active. */
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
}

export function PenTool(props: PenToolProps): ReactElement {
  const { camera, color, thickness, create, wheel } = props;
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const pointsRef = useRef<WorldPoint[]>([]);
  const isDrawingRef = useRef(false);
  const rafRef = useRef<number>(0);
  const pendingPointsRef = useRef<WorldPoint[]>([]);
  const startScreenRef = useRef<Point | null>(null);

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const cursorSize = thicknessWorld * camera.zoom;

  const getScreenPoint = (e: ReactPointerEvent): Point => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const schedulePreview = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const pts = pointsRef.current;
      if (pts.length === 0) {
        setPreviewPath(null);
        return;
      }
      // Convert world points to screen space for preview
      const screenPts = pts.map(p => worldToScreen(camera, p));
      setPreviewPath(smoothPath(screenPts));
    });
  }, [camera]);

  const commitPoints = useCallback((pts: WorldPoint[]) => {
    if (pts.length === 0) return;
    if (pts.length === 1) {
      // Dot
      create(pts);
    } else {
      // Simplify with zoom-scaled tolerance
      const simplified = simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom);
      create(simplified);
    }
  }, [create, camera.zoom]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}

    const sp = getScreenPoint(e);
    startScreenRef.current = sp;
    const wp = screenToWorld(camera, sp);
    pointsRef.current = [wp];
    pendingPointsRef.current = [wp];
    isDrawingRef.current = true;

    // Show initial dot preview
    setPreviewPath(`M ${sp.x} ${sp.y} L ${sp.x} ${sp.y}`);
  }, [camera]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!isDrawingRef.current) return;

    // Use coalesced events for smoother strokes
    const nativeEvent = e.nativeEvent as PointerEvent;
    const events = nativeEvent.getCoalescedEvents?.() ?? [nativeEvent];

    for (const ev of events) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const sp: Point = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      const wp = screenToWorld(camera, sp);
      pointsRef.current.push(wp);
      pendingPointsRef.current.push(wp);
    }

    // Check if we've hit the point limit
    if (pointsRef.current.length >= STROKE_MAX_POINTS) {
      // Commit current part and restart
      commitPoints(pointsRef.current);
      // Restart with the last point
      const lastPoint = pointsRef.current[pointsRef.current.length - 1];
      pointsRef.current = [lastPoint];
      pendingPointsRef.current = [lastPoint];
    }

    schedulePreview();
  }, [camera, commitPoints, schedulePreview]);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}

    const sp = getScreenPoint(e);
    const start = startScreenRef.current;
    startScreenRef.current = null;

    // Determine if this is a click (dot) or a drag
    if (start) {
      const dx = sp.x - start.x;
      const dy = sp.y - start.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < DRAG_THRESHOLD_PX) {
        // Click: single-point dot
        const wp = screenToWorld(camera, sp);
        commitPoints([wp]);
      } else {
        // Drag: commit all points
        commitPoints(pointsRef.current);
      }
    }

    pointsRef.current = [];
    pendingPointsRef.current = [];
    setPreviewPath(null);
  }, [camera, commitPoints]);

  const onPointerCancel = useCallback((e: ReactPointerEvent) => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}

    // Interrupted: commit points so far
    if (pointsRef.current.length > 0) {
      commitPoints(pointsRef.current);
    }

    pointsRef.current = [];
    pendingPointsRef.current = [];
    startScreenRef.current = null;
    setPreviewPath(null);
  }, [commitPoints]);

  const onLostPointerCapture = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    // Lost capture: commit points so far
    if (pointsRef.current.length > 0) {
      commitPoints(pointsRef.current);
    }

    pointsRef.current = [];
    pendingPointsRef.current = [];
    startScreenRef.current = null;
    setPreviewPath(null);
  }, [commitPoints]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Forward wheel events for pan/zoom
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !wheel) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();
      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) { deltaX *= 16; deltaY *= 16; }
      else if (e.deltaMode === 2) { deltaX *= 100; deltaY *= 100; }
      const rect = el.getBoundingClientRect();
      wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wheel]);

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        cursor: `circle ${cursorSize}px ${cursorSize}px`,
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
    >
      {previewPath && (
        <svg
          data-testid="pen-preview"
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
            stroke={color === 'black' ? '#212121' : typeof PEN_COLORS[color] === 'string' ? PEN_COLORS[color] : '#212121'}
            strokeWidth={thicknessWorld * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
