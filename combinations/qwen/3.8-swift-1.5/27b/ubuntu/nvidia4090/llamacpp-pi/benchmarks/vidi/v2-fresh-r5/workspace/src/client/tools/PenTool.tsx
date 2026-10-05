/**
 * Pen tool (story 11). Captures coalesced pointer points into a local,
 * never-synced preview overlay; on release (or cancel, or reaching
 * STROKE_MAX_POINTS) it simplifies the points and commits one stroke object
 * (pen.draw, pen.dot, pen.long_stroke, pen.interrupted, pen.share). The pen
 * stays active after each commit (pen.stay_active).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Called after each committed stroke (undo boundary, story 8). */
  onCommit?: () => void;
}

/**
 * Full-window pen overlay. Pointer events are routed here while the Pen tool
 * is active, so drags never pan the board or move objects underneath
 * (pen.navigation).
 */
export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness, doc, identityId, onCommit } = props;

  const camRef = useRef(camera);
  camRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  /** World-space points of the stroke in progress (local only). */
  const pointsRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);
  const startScreenRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);

  const [previewPts, setPreviewPts] = useState<Point[] | null>(null);
  const [cursorPos, setCursorPos] = useState<Point | null>(null);

  const schedulePreview = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPreviewPts(pointsRef.current.length > 0 ? [...pointsRef.current] : null);
    });
  }, []);

  const clearPreview = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pointsRef.current = [];
    setPreviewPts(null);
  }, []);

  /** Simplify and commit the given world points as one stroke. */
  const commitStroke = useCallback(
    (pts: Point[]) => {
      if (pts.length === 0) return;
      const zoom = camRef.current.zoom;
      const toCommit =
        pts.length > 1 ? simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / zoom) : pts;
      // A rejected stroke (invalid input) clears the preview silently.
      createStroke(doc, { points: toCommit, color: colorRef.current, thickness: thicknessRef.current }, identityId);
      onCommitRef.current?.();
    },
    [doc, identityId],
  );

  const finishStroke = useCallback(
    (releaseScreen: Point | null) => {
      const pts = pointsRef.current;
      const start = startScreenRef.current;
      drawingRef.current = false;
      startScreenRef.current = null;

      // A press without movement draws a round dot (pen.dot).
      if (releaseScreen !== null && start !== null &&
          Math.hypot(releaseScreen.x - start.x, releaseScreen.y - start.y) < DRAG_THRESHOLD_PX) {
        clearPreview();
        const startWorld = screenToWorld(camRef.current, start);
        commitStroke([startWorld]);
        return;
      }
      // Release, cancel, or lost capture: keep the points drawn so far
      // (pen.interrupted).
      clearPreview();
      commitStroke(pts);
    },
    [clearPreview, commitStroke],
  );

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    startScreenRef.current = { x: e.clientX, y: e.clientY };
    pointsRef.current = [screenToWorld(camRef.current, { x: e.clientX, y: e.clientY })];
    schedulePreview();
  }, [schedulePreview]);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      if (!drawingRef.current) return;
      e.preventDefault();

      // Coalesced events keep the line faithful to fast pointers.
      const native = e.nativeEvent as PointerEvent;
      const events: PointerEvent[] =
        typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
          ? native.getCoalescedEvents()
          : [native];
      for (const ev of events) {
        pointsRef.current.push(screenToWorld(camRef.current, { x: ev.clientX, y: ev.clientY }));
      }

      // Very long strokes split into consecutive strokes that join seamlessly
      // (pen.long_stroke).
      if (pointsRef.current.length >= STROKE_MAX_POINTS) {
        const part = pointsRef.current;
        const last = part[part.length - 1];
        drawingRef.current = false;
        clearPreview();
        commitStroke(part);
        drawingRef.current = true;
        pointsRef.current = [last];
      }
      schedulePreview();
    },
    [clearPreview, commitStroke, schedulePreview],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      finishStroke({ x: e.clientX, y: e.clientY });
    },
    [finishStroke],
  );

  const handlePointerCancel = useCallback(() => {
    if (!drawingRef.current) return;
    finishStroke(null);
  }, [finishStroke]);

  const handleLostPointerCapture = useCallback(() => {
    if (!drawingRef.current) return;
    finishStroke(null);
  }, [finishStroke]);

  const handlePointerLeave = useCallback(() => {
    setCursorPos(null);
  }, []);

  // The overlay covers the viewport, so the viewport's native wheel listener
  // never sees wheel events. Forward them unchanged: wheel behaviour (pan /
  // ctrl+zoom) is exactly the same as without the Pen (pen.navigation).
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const vp = document.querySelector('.board-viewport');
      if (!vp) return;
      vp.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const strokeColor = PEN_COLORS[color];
  const strokeWidthWorld = PEN_THICKNESS_WORLD[thickness];
  const cursorSize = strokeWidthWorld * camera.zoom;

  // Screen-space preview path (local overlay, never written to the doc).
  let previewD: string | null = null;
  if (previewPts && previewPts.length > 0) {
    const screenPts = previewPts.map((p) => worldToScreen(camera, p));
    previewD = smoothPath(screenPts);
  }

  return (
    <svg
      ref={svgRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'all',
        cursor: 'none',
        touchAction: 'none',
        zIndex: 50,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerLeave={handlePointerLeave}
    >
      {previewD !== null && (
        <path
          data-testid="pen-preview-path"
          d={previewD}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidthWorld * camera.zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Round pointer preview sized to the current thickness at this zoom */}
      {cursorPos !== null && (
        <circle
          data-testid="pen-cursor"
          cx={cursorPos.x}
          cy={cursorPos.y}
          r={Math.max(cursorSize / 2, 1)}
          fill={strokeColor}
          fillOpacity={0.35}
          stroke={strokeColor}
          strokeWidth={1}
        />
      )}
    </svg>
  );
}
