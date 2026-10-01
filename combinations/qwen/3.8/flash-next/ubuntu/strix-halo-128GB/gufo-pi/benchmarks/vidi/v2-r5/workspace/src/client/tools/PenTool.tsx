import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import {
  type PenColor,
  type PenThickness,
  PEN_THICKNESS_WORLD,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  STROKE_MAX_POINTS,
  DRAG_THRESHOLD_PX,
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Called after a stroke is committed (for undo boundary) */
  onCommit?(): void;
}

interface DrawingState {
  points: Point[];
  startScreen: Point;
}

/**
 * PenTool: overlay component that captures pointer events while the Pen tool is active.
 * Draws a local-only SVG preview during drag; commits a stroke on pointerup, pointercancel,
 * or when STROKE_MAX_POINTS is reached (then restarts from the last point).
 *
 * The preview is never written to the Y.Doc, so collaborators do not see in-progress strokes.
 */
export function PenTool({ camera, color, thickness, doc, identityId, onCommit }: PenToolProps) {
  const [previewPath, setPreviewPath] = useState<string>('');
  const drawingRef = useRef<DrawingState | null>(null);
  const rafRef = useRef<number>(0);
  const viewportRef = useRef<HTMLDivElement>(null);
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
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const schedulePreview = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const state = drawingRef.current;
      if (!state || state.points.length === 0) {
        setPreviewPath('');
        return;
      }
      // Convert world points to screen space for preview
      const cam = cameraRef.current;
      const screenPoints: Point[] = state.points.map((p) => ({
        x: (p.x - cam.x) * cam.zoom,
        y: (p.y - cam.y) * cam.zoom,
      }));
      setPreviewPath(smoothPath(screenPoints));
    });
  }, []);

  const commitStroke = useCallback((points: readonly Point[]): void => {
    if (points.length === 0) return;
    const cam = cameraRef.current;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;

    let id: string | null;
    if (points.length === 1) {
      // Single point → dot
      id = createStroke(docRef.current, {
        points: [points[0]!],
        color: colorRef.current,
        thickness: thicknessRef.current,
      }, identityRef.current);
    } else {
      const simplified = simplify(points, tolerance);
      id = createStroke(docRef.current, {
        points: simplified,
        color: colorRef.current,
        thickness: thicknessRef.current,
      }, identityRef.current);
    }

    if (id && onCommitRef.current) {
      onCommitRef.current();
    }
  }, []);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const cam = cameraRef.current;
    const screen = { x: e.clientX, y: e.clientY };
    const world = screenToWorld(cam, screen);

    drawingRef.current = { points: [world], startScreen: screen };
    schedulePreview();

    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort (not available in jsdom)
    }
  }, [schedulePreview]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drawingRef.current;
    if (!state) return;
    e.stopPropagation();

    const cam = cameraRef.current;

    // Use coalesced events for smoother capture
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const events = coalesced.length > 0 ? coalesced : [e.nativeEvent];
    for (const ce of events) {
      const world = screenToWorld(cam, { x: ce.clientX, y: ce.clientY });
      state.points.push(world);
    }

    // Check for max points: commit and restart
    if (state.points.length >= STROKE_MAX_POINTS) {
      // Commit this part as a stroke
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
      const simplified = simplify(state.points, tolerance);
      const id = createStroke(docRef.current, {
        points: simplified,
        color: colorRef.current,
        thickness: thicknessRef.current,
      }, identityRef.current);
      if (id && onCommitRef.current) {
        onCommitRef.current();
      }
      // Restart from last point
      const lastPoint = state.points[state.points.length - 1]!;
      state.points = [lastPoint];
    }

    schedulePreview();
  }, [schedulePreview]);

  const finishStroke = useCallback((): void => {
    const state = drawingRef.current;
    if (!state) return;

    // Check if it was just a click (movement below DRAG_THRESHOLD_PX)
    if (state.points.length <= 1) {
      // Dot
      if (state.points.length === 1) {
        commitStroke([state.points[0]!]);
      }
    } else {
      commitStroke(state.points);
    }

    drawingRef.current = null;
    setPreviewPath('');
  }, [commitStroke]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const state = drawingRef.current;
    if (!state) return;
    e.stopPropagation();

    // Check if movement was below threshold → single dot
    const screenDist = Math.hypot(e.clientX - state.startScreen.x, e.clientY - state.startScreen.y);
    if (screenDist < DRAG_THRESHOLD_PX && state.points.length <= 2) {
      // Single point dot: use the initial world point
      drawingRef.current = { points: [state.points[0]!], startScreen: state.startScreen };
      finishStroke();
    } else {
      finishStroke();
    }
  }, [finishStroke]);

  const handlePointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    // Treat cancel as finishing the stroke with points so far
    finishStroke();
  }, [finishStroke]);

  const handleLostPointerCapture = useCallback((_e: React.PointerEvent<HTMLDivElement>) => {
    // If drawing was still active when capture was lost, commit it
    if (drawingRef.current) {
      finishStroke();
    }
  }, [finishStroke]);

  // Clean up RAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const thicknessPx = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  return (
    <div
      ref={viewportRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        cursor: 'none',
        pointerEvents: 'auto',
        zIndex: 10001,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
    >
      {/* Round cursor indicator */}
      <div
        data-testid="pen-cursor"
        style={{
          position: 'fixed',
          width: thicknessPx,
          height: thicknessPx,
          borderRadius: '50%',
          backgroundColor: 'rgba(0,0,0,0.5)',
          pointerEvents: 'none',
          transform: 'translate(-50%, -50%)',
          display: 'none',
        }}
      />
      {/* Preview path (screen space, local only) */}
      {previewPath && (
        <svg
          data-testid="pen-preview"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <path
            d={previewPath}
            fill="none"
            stroke={color}
            strokeWidth={thicknessPx}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
