import { useRef, useCallback, useEffect, type ReactElement } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, type Camera, type Point } from '@client/canvas/camera';
import { simplify, smoothPath } from '@shared/geometry/simplify';
import { createStroke } from '@shared/objects/stroke';
import {
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '@shared/config';

export interface PenToolProps {
  camera: Camera;
  cameraRef: React.MutableRefObject<Camera>;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  viewportEl: HTMLElement | null;
  onCommit?(): void;
  onGestureBoundary?(): void;
}

interface DrawingState {
  points: Point[];
  startScreen: Point;
  totalCommitted: number;
}

/**
 * PenTool: captures pointer events for freehand drawing.
 * Renders a transparent overlay that captures all pointer events (including over objects).
 * Shows a local SVG preview; commits stroke on release/cancel/limit.
 */
export function PenTool({
  camera,
  cameraRef,
  color,
  thickness,
  doc,
  identityId,
  viewportEl,
  onCommit,
  onGestureBoundary,
}: PenToolProps): ReactElement {
  const drawingRef = useRef<DrawingState | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);
  const rafRef = useRef<number>(0);
  const needsRedrawRef = useRef(false);

  const getCam = useCallback(
    () => cameraRef.current ?? camera,
    [cameraRef, camera],
  );

  const getLocalPoint = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      if (!viewportEl) return { x: 0, y: 0 };
      const rect = viewportEl.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [viewportEl],
  );

  const updatePreview = useCallback(() => {
    const state = drawingRef.current;
    const pathEl = pathRef.current;
    if (!state || !pathEl) return;

    const cam = getCam();
    const screenPts: Point[] = state.points.map((p) => ({
      x: (p.x - cam.x) * cam.zoom,
      y: (p.y - cam.y) * cam.zoom,
    }));

    pathEl.setAttribute('d', smoothPath(screenPts));
    needsRedrawRef.current = false;
  }, [getCam]);

  const scheduleRedraw = useCallback(() => {
    if (!needsRedrawRef.current) {
      needsRedrawRef.current = true;
      rafRef.current = requestAnimationFrame(updatePreview);
    }
  }, [updatePreview]);

  const commitPart = useCallback((points: Point[]) => {
    if (points.length === 0) return;
    const cam = getCam();
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
    const simplified = simplify(points, tolerance);
    if (simplified.length === 0) return;

    if (onGestureBoundary) onGestureBoundary();
    createStroke(doc, { points: simplified, color, thickness }, identityId);
    if (onGestureBoundary) onGestureBoundary();
    if (onCommit) onCommit();
  }, [getCam, doc, color, thickness, identityId, onGestureBoundary, onCommit]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const cam = getCam();
      const screenPt = getLocalPoint(e);
      const worldPt = screenToWorld(cam, screenPt);
      drawingRef.current = { points: [worldPt], startScreen: screenPt, totalCommitted: 0 };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

      // Show initial dot preview
      const pathEl = pathRef.current;
      if (pathEl) {
        const sx = (worldPt.x - cam.x) * cam.zoom;
        const sy = (worldPt.y - cam.y) * cam.zoom;
        pathEl.setAttribute('d', smoothPath([{ x: sx, y: sy }]));
      }
    },
    [getCam, getLocalPoint],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const state = drawingRef.current;
      if (!state) return;

      // Use coalesced events for higher fidelity if available
      const events: PointerEvent[] = [];
      if ('getCoalescedEvents' in e.nativeEvent && typeof (e.nativeEvent as any).getCoalescedEvents === 'function') {
        const coalesced = (e.nativeEvent as any).getCoalescedEvents();
        if (coalesced && coalesced.length > 0) {
          events.push(...coalesced);
        } else {
          events.push(e.nativeEvent);
        }
      } else {
        events.push(e.nativeEvent);
      }

      const cam = getCam();
      for (const ev of events) {
        const screenPt = getLocalPoint({ clientX: ev.clientX, clientY: ev.clientY });
        const worldPt = screenToWorld(cam, screenPt);
        state.points.push(worldPt);
      }

      // Check max points limit
      if (state.points.length >= STROKE_MAX_POINTS) {
        const part = state.points;
        commitPart(part);
        state.totalCommitted += part.length;
        // Restart from last point
        state.points = [part[part.length - 1]];
      }

      scheduleRedraw();
    },
    [getCam, getLocalPoint, scheduleRedraw, commitPart],
  );

  const finishStroke = useCallback(
    (e: React.PointerEvent) => {
      const state = drawingRef.current;
      if (!state) return;
      drawingRef.current = null;

      // Clear preview
      const pathEl = pathRef.current;
      if (pathEl) pathEl.setAttribute('d', '');

      // Check if it was a click (dot)
      const endScreen = getLocalPoint(e);
      const dx = endScreen.x - state.startScreen.x;
      const dy = endScreen.y - state.startScreen.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < DRAG_THRESHOLD_PX && state.points.length <= 2) {
        // Dot: single point
        if (onGestureBoundary) onGestureBoundary();
        createStroke(doc, { points: [state.points[0]], color, thickness }, identityId);
        if (onGestureBoundary) onGestureBoundary();
        if (onCommit) onCommit();
        return;
      }

      // Normal stroke
      commitPart(state.points);
    },
    [getCam, doc, color, thickness, identityId, getLocalPoint, commitPart, onGestureBoundary, onCommit],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      e.stopPropagation();
      finishStroke(e);
    },
    [finishStroke],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      e.stopPropagation();
      finishStroke(e);
    },
    [finishStroke],
  );

  // Forward wheel events to the viewport so panning/zooming works while pen is active
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !viewportEl) return;
    const handler = (e: WheelEvent) => {
      viewportEl.dispatchEvent(new WheelEvent('wheel', {
        deltaY: e.deltaY,
        deltaX: e.deltaX,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        bubbles: false,
        cancelable: true,
      }));
    };
    overlay.addEventListener('wheel', handler, { passive: false });
    return () => overlay.removeEventListener('wheel', handler);
  }, [viewportEl]);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const cursorSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        cursor: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <svg
        ref={svgRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
        data-testid="pen-preview-svg"
      >
        <path
          ref={pathRef}
          d=""
          fill="none"
          stroke={color === 'black' ? '#212121' : undefined}
          strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-testid="pen-preview-path"
        />
      </svg>
      {/* Round cursor */}
      <div
        data-testid="pen-cursor"
        style={{
          position: 'absolute',
          width: cursorSize,
          height: cursorSize,
          borderRadius: '50%',
          border: '1px solid #666',
          background: 'rgba(0,0,0,0.2)',
          pointerEvents: 'none',
          transform: 'translate(-50%, -50%)',
          display: 'none',
        }}
      />
    </div>
  );
}
