/**
 * Pen tool (story 11, pen.tool).
 *
 * Screen-space overlay that captures pointer events when the Pen tool is active.
 * Records points, shows a local preview, and commits strokes on release/cancel/limit.
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Point } from '../../shared/geometry';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  DRAG_THRESHOLD_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type * as Y from 'yjs';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  canEdit: boolean;
  undo?: UndoController;
  getBoardRect(): DOMRect | null;
}

/** Extract coalesced events or fall back to the current event's position. */
function getPointsFromEvent(
  e: React.PointerEvent,
  getScreenPoint: (e: { clientX: number; clientY: number }) => Point,
): Point[] {
  // getCoalescedEvents may exist but return empty array (e.g. jsdom)
  const coalesced = (e.nativeEvent as any).getCoalescedEvents?.();
  if (coalesced && coalesced.length > 0) {
    return coalesced.map((ce: PointerEvent) => getScreenPoint(ce));
  }
  // Fall back to the event's own coordinates
  return [getScreenPoint(e)];
}

export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness, doc, identityId, canEdit, undo, getBoardRect } = props;
  const [previewPoints, setPreviewPoints] = useState<Point[] | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rawPointsRef = useRef<Point[]>([]);
  const startScreenRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const getScreenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const boardRect = getBoardRect();
    if (!boardRect) return { x: e.clientX, y: e.clientY };
    return { x: e.clientX - boardRect.left, y: e.clientY - boardRect.top };
  }, [getBoardRect]);

  const commitStroke = useCallback((points: readonly Point[]) => {
    if (points.length === 0) return;
    const cam = cameraRef.current;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
    let finalPoints: Point[];
    if (points.length === 1) {
      finalPoints = [points[0]];
    } else {
      finalPoints = simplify(points, tolerance);
    }
    undo?.boundary();
    createStroke(doc, { points: finalPoints, color, thickness }, identityId);
    undo?.boundary();
  }, [doc, color, thickness, identityId, undo]);

  const schedulePreview = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPreviewPoints([...rawPointsRef.current]);
    });
  }, []);

  const cancelPreview = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPreviewPoints(null);
  }, []);

  const handleFinish = useCallback(() => {
    const points = rawPointsRef.current;
    rawPointsRef.current = [];
    pointerIdRef.current = null;
    startScreenRef.current = null;
    cancelPreview();
    commitStroke(points);
  }, [commitStroke, cancelPreview]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!canEdit) return;
    pointerIdRef.current = e.pointerId;
    const sp = getScreenPoint(e);
    startScreenRef.current = sp;
    const wp = screenToWorld(cameraRef.current, sp);
    rawPointsRef.current = [wp];
    schedulePreview();
  }, [canEdit, getScreenPoint, schedulePreview]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const pts = getPointsFromEvent(e, getScreenPoint);
    for (const sp of pts) {
      const wp = screenToWorld(cameraRef.current, sp);
      rawPointsRef.current.push(wp);
    }

    // Check STROKE_MAX_POINTS limit
    if (rawPointsRef.current.length >= STROKE_MAX_POINTS) {
      const part = rawPointsRef.current.slice();
      rawPointsRef.current = [part[part.length - 1]];
      commitStroke(part);
    }

    schedulePreview();
  }, [getScreenPoint, schedulePreview, commitStroke]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;

    const start = startScreenRef.current;
    // If barely moved, reduce to single dot
    if (start && rawPointsRef.current.length > 1) {
      const sp = getScreenPoint(e);
      const dist = Math.hypot(sp.x - start.x, sp.y - start.y);
      if (dist < DRAG_THRESHOLD_PX) {
        rawPointsRef.current = [rawPointsRef.current[0]];
      }
    }

    handleFinish();
  }, [getScreenPoint, handleFinish]);

  const onPointerCancel = useCallback((e: React.PointerEvent) => {
    if (pointerIdRef.current !== e.pointerId) return;
    handleFinish();
  }, [handleFinish]);

  // Build preview path from accumulated points
  let previewPath: string | null = null;
  if (previewPoints && previewPoints.length > 0) {
    previewPath = smoothPath(previewPoints);
  }

  const dotSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  return (
    <div
      className="pen-tool-overlay"
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 9999,
        cursor: 'crosshair',
        pointerEvents: 'auto',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {previewPath && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
          data-testid="pen-preview"
        >
          <path
            d={previewPath}
            fill="none"
            stroke={color}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
            transform={`scale(${camera.zoom}) translate(${-camera.x}, ${-camera.y})`}
            style={{ transformOrigin: '0 0' }}
          />
        </svg>
      )}
      {/* Round cursor preview */}
      <div
        data-testid="pen-cursor"
        style={{
          position: 'fixed',
          width: `${dotSize}px`,
          height: `${dotSize}px`,
          borderRadius: '50%',
          border: '1px solid rgba(0,0,0,0.5)',
          background: 'rgba(0,0,0,0.15)',
          pointerEvents: 'none',
          transform: 'translate(-50%, -50%)',
          display: 'none',
        }}
      />
    </div>
  );
}
