/**
 * PenTool (story 11): captures pointer gestures, renders local preview SVG,
 * commits strokes on release/cancel/limit. Never writes to Y.Doc during drawing.
 */
import React, { useRef, useCallback, useState } from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import type { Point } from '../../shared/geometry';
import type { PenColor, PenThickness } from '../../shared/config';
import { PEN_THICKNESS_WORLD, PEN_COLORS, STROKE_SIMPLIFY_TOLERANCE_PX, STROKE_MAX_POINTS, DRAG_THRESHOLD_PX } from '../../shared/config';
import { simplify } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Whether the pen tool is currently active. */
  active: boolean;
  /** Called before committing (undo boundary). */
  onBeforeCommit?(): void;
  /** Called after committing (undo boundary). */
  onAfterCommit?(): void;
}

export interface PenToolHandle {
  handlePointerDown(screenX: number, screenY: number): void;
  handlePointerMove(screenX: number, screenY: number): void;
  handlePointerUp(screenX: number, screenY: number): void;
  handlePointerCancel(): void;
}

export function PenTool({ camera, color, thickness, doc, identityId, active, onBeforeCommit, onAfterCommit }: PenToolProps): {
  handlePointerDown: (sx: number, sy: number) => void;
  handlePointerMove: (sx: number, sy: number) => void;
  handlePointerUp: (sx: number, sy: number) => void;
  handlePointerCancel: () => void;
  previewPoints: Point[];
} {
  const [previewPoints, setPreviewPoints] = useState<Point[]>([]);
  const drawingRef = useRef(false);
  const pointsRef = useRef<Point[]>([]);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const rafIdRef = useRef<number>(0);
  const previewDirtyRef = useRef(false);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;

  const finishStroke = useCallback((pts: readonly Point[]) => {
    if (pts.length === 0) return;
    const zoom = cameraRef.current.zoom;
    let simplified: Point[];
    if (pts.length === 1) {
      simplified = [pts[0]];
    } else {
      simplified = simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    }
    if (onBeforeCommit) onBeforeCommit();
    createStroke(doc, { points: simplified, color: colorRef.current, thickness: thicknessRef.current }, identityId);
    if (onAfterCommit) onAfterCommit();
  }, [doc, identityId, onBeforeCommit, onAfterCommit]);

  const schedulePreview = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      if (previewDirtyRef.current) {
        previewDirtyRef.current = false;
        setPreviewPoints([...pointsRef.current]);
      }
    });
  }, []);

  const commitAndRestart = useCallback((lastPoint: Point) => {
    const pts = pointsRef.current;
    if (pts.length > 0) {
      finishStroke(pts);
    }
    pointsRef.current = [lastPoint];
    setPreviewPoints([...pointsRef.current]);
  }, [finishStroke]);

  const handlePointerDown = useCallback((screenX: number, screenY: number) => {
    if (!active) return;
    drawingRef.current = true;
    startRef.current = { x: screenX, y: screenY };
    const world = screenToWorld(cameraRef.current, { x: screenX, y: screenY });
    pointsRef.current = [world];
    setPreviewPoints([world]);
  }, [active]);

  const handlePointerMove = useCallback((screenX: number, screenY: number) => {
    if (!drawingRef.current) return;
    const world = screenToWorld(cameraRef.current, { x: screenX, y: screenY });
    pointsRef.current.push(world);

    // Check STROKE_MAX_POINTS
    if (pointsRef.current.length >= STROKE_MAX_POINTS) {
      const lastPt = pointsRef.current[pointsRef.current.length - 1];
      commitAndRestart(lastPt);
      return;
    }

    // Mark preview dirty; will render on next rAF
    previewDirtyRef.current = true;
    schedulePreview();
  }, [commitAndRestart, schedulePreview]);

  const handlePointerUp = useCallback((screenX: number, screenY: number) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    const start = startRef.current;
    const dist = start ? Math.hypot(screenX - start.x, screenY - start.y) : 0;

    if (dist < DRAG_THRESHOLD_PX) {
      // Click: draw a dot (single point)
      finishStroke([pointsRef.current[0]]);
    } else {
      finishStroke(pointsRef.current);
    }

    pointsRef.current = [];
    setPreviewPoints([]);
    startRef.current = null;
  }, [finishStroke]);

  const handlePointerCancel = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    // Interrupted: commit points drawn so far
    if (pointsRef.current.length > 0) {
      finishStroke(pointsRef.current);
    }
    pointsRef.current = [];
    setPreviewPoints([]);
    startRef.current = null;
  }, [finishStroke]);

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    previewPoints,
  };
}

/**
 * PenPreview: renders the local SVG preview overlay (screen-space).
 */
export function PenPreview({ points, camera, thickness, color }: {
  points: Point[];
  camera: Camera;
  thickness: PenThickness;
  color: PenColor;
}) {
  if (points.length === 0) return null;

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const strokeWidth = thicknessWorld * camera.zoom;
  const colorHex = PEN_COLORS[color];

  // Convert world points to screen space
  let d = '';
  if (points.length === 1) {
    const sx = (points[0].x - camera.x) * camera.zoom;
    const sy = (points[0].y - camera.y) * camera.zoom;
    d = `M ${sx} ${sy} L ${sx} ${sy}`;
  } else {
    const screenPts = points.map((p) => ({
      x: (p.x - camera.x) * camera.zoom,
      y: (p.y - camera.y) * camera.zoom,
    }));
    d = `M ${screenPts[0].x} ${screenPts[0].y}`;
    for (let i = 1; i < screenPts.length; i++) {
      d += ` L ${screenPts[i].x} ${screenPts[i].y}`;
    }
  }

  return (
    <svg
      data-testid="pen-preview"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 25,
      }}
    >
      <path
        d={d}
        fill="none"
        stroke={colorHex}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
