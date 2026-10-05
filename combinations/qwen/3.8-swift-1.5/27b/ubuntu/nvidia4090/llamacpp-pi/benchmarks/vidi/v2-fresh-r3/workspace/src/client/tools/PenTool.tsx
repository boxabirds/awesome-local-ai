import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Story 8: the undo controller — stopCapturing after each commit. */
  undo?: UndoController;
}

/**
 * The pen tool (pen.tool): captures coalesced pointer points into a local,
 * never-synced preview; on release (or cancel, or reaching STROKE_MAX_POINTS)
 * it simplifies the points with RDP at a zoom-scaled tolerance and commits
 * one stroke object in a single LOCAL_ORIGIN transaction (createStroke).
 *
 * - The in-progress preview is a screen-space SVG overlay that is never
 *   written to the Y.Doc, so others don't see a stroke while it is drawn
 *   (pen.share).
 * - A press and release with movement below DRAG_THRESHOLD_PX commits a
 *   single-point dot (pen.dot).
 * - pointercancel / lostpointercapture finish the stroke with the points so
 *   far (pen.interrupted).
 * - At STROKE_MAX_POINTS raw points the part is committed and drawing
 *   continues from the shared join point (pen.long_stroke).
 * - The Pen stays active after each commit (pen.stay_active); switching tools
 *   is handled by useActiveTool / useBoardKeys.
 */
export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness, doc, identityId, undo } = props;
  const overlayRef = useRef<HTMLDivElement>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;

  const pointsRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [previewD, setPreviewD] = useState<string | null>(null);

  // Redraw the local preview once per animation frame (pen.draw).
  const schedulePreview = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const pts = pointsRef.current;
      if (pts.length === 0) {
        setPreviewD(null);
        return;
      }
      const cam = cameraRef.current;
      setPreviewD(smoothPath(pts.map((p) => worldToScreen(cam, p))));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /** Simplify (unless a dot) and commit one stroke; one undo step. */
  const commit = useCallback(
    (pts: Point[], dot: boolean): string | null => {
      const cam = cameraRef.current;
      const simplified = dot ? pts : simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom);
      const id = createStroke(
        doc,
        { points: simplified, color: colorRef.current, thickness: thicknessRef.current },
        identityId,
      );
      // Rejected strokes (null) clear the preview silently (no undo step).
      if (id !== null) undo?.boundary();
      return id;
    },
    [doc, identityId, undo],
  );

  const finish = useCallback(
    (asDot: boolean) => {
      const pts = pointsRef.current;
      pointsRef.current = [];
      drawingRef.current = false;
      setPreviewD(null);
      if (pts.length === 0) return;
      if (asDot || pts.length === 1) commit([pts[0]], true);
      else commit(pts, false);
    },
    [commit],
  );

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    return screenToWorld(cameraRef.current, { x: clientX, y: clientY });
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pointsRef.current = [toWorld(e.clientX, e.clientY)];
      drawingRef.current = true;
      schedulePreview();
    },
    [schedulePreview, toWorld],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const native = e.nativeEvent as PointerEvent;
      // Coalesced events keep the line faithful at the input rate.
      const events: PointerEvent[] =
        typeof native.getCoalescedEvents === 'function' && native.getCoalescedEvents().length > 0
          ? native.getCoalescedEvents()
          : [native];
      for (const ev of events) {
        pointsRef.current.push(toWorld(ev.clientX, ev.clientY));
      }
      // Very long strokes: commit the part and continue from the join point.
      while (pointsRef.current.length >= STROKE_MAX_POINTS) {
        const part = pointsRef.current.slice(0, STROKE_MAX_POINTS);
        const join = part[part.length - 1];
        pointsRef.current = [join];
        commit(part, false);
      }
      schedulePreview();
    },
    [commit, schedulePreview, toWorld],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const pts = pointsRef.current;
      const moved =
        pts.length >= 2 &&
        Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) *
          cameraRef.current.zoom >=
          DRAG_THRESHOLD_PX;
      finish(!moved);
    },
    [finish],
  );

  // Interrupted strokes are kept: finish with the points drawn so far.
  const handlePointerCancel = useCallback(() => {
    finish(false);
  }, [finish]);

  const handleLostPointerCapture = useCallback(() => {
    if (drawingRef.current) finish(false);
  }, [finish]);

  // Round pointer preview sized to the thickness at the current zoom.
  const cursorDiameter = Math.max(2, Math.round(PEN_THICKNESS_WORLD[thickness] * camera.zoom));
  const cursorR = Math.max(1, cursorDiameter / 2 - 0.5);
  const cursorSvg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${cursorDiameter}' height='${cursorDiameter}'>` +
    `<circle cx='${cursorDiameter / 2}' cy='${cursorDiameter / 2}' r='${cursorR}' fill='none' stroke='black' stroke-width='1'/></svg>`;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${cursorDiameter / 2} ${cursorDiameter / 2}, crosshair`;

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor,
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      {previewD !== null && (
        <svg
          data-testid="pen-preview-svg"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          <path
            data-testid="pen-preview"
            d={previewD}
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
