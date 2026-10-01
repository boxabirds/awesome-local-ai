/**
 * PenTool: captures pointer events, draws a local SVG preview,
 * and commits strokes on pointerup/cancel/reaching STROKE_MAX_POINTS.
 *
 * Renders a full-viewport overlay that intercepts all pointer events
 * so drags never pan or move objects underneath.
 */
import { useCallback, useRef, useState } from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld } from '../canvas/camera';
import { STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX, PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';
import { simplify, splitPoints, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import * as Y from 'yjs';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  undoBoundary(): void;
}

interface DrawState {
  /** World-space points collected during drawing */
  worldPoints: Point[];
  /** Screen-space points for the preview path */
  screenPoints: Point[];
  /** Whether the pointer is down */
  active: boolean;
}

export function PenTool(props: PenToolProps): React.JSX.Element {
  const { camera, color, thickness, doc, identityId, undoBoundary } = props;
  const [previewPath, setPreviewPath] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<DrawState>({ worldPoints: [], screenPoints: [], active: false });
  const rafRef = useRef<number | null>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;

  const pointOf = useCallback((clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const schedulePreviewUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const state = stateRef.current;
      if (state.screenPoints.length > 0) {
        setPreviewPath(smoothPath(state.screenPoints));
      }
    });
  }, []);

  const finishStroke = useCallback(() => {
    const state = stateRef.current;
    if (!state.active) return;
    state.active = false;

    const pts = state.worldPoints;
    if (pts.length === 0) {
      setPreviewPath('');
      return;
    }

    undoBoundary();
    if (pts.length === 1) {
      // Dot: single point
      createStroke(doc, { points: pts, color: colorRef.current, thickness: thicknessRef.current }, identityId);
    } else {
      const cam = cameraRef.current;
      const tol = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
      const simplified = simplify(pts, tol);
      createStroke(doc, { points: simplified, color: colorRef.current, thickness: thicknessRef.current }, identityId);
    }
    undoBoundary();

    state.worldPoints = [];
    state.screenPoints = [];
    setPreviewPath('');
  }, [doc, identityId, undoBoundary]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture?.(e.pointerId);

    const screenPt = pointOf(e.clientX, e.clientY);
    const worldPt = screenToWorld(cameraRef.current, screenPt);

    const state = stateRef.current;
    state.active = true;
    state.worldPoints = [worldPt];
    state.screenPoints = [screenPt];
    setPreviewPath(smoothPath(state.screenPoints));
  }, [pointOf]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current;
    if (!state.active) return;

    // Use coalesced events if available
    const events: { clientX: number; clientY: number }[] = [];
    if (typeof (e as any).getCoalescedEvents === 'function') {
      const coalesced = (e as any).getCoalescedEvents();
      if (coalesced && coalesced.length > 0) {
        for (const ce of coalesced) {
          events.push({ clientX: ce.clientX, clientY: ce.clientY });
        }
      }
    }
    if (events.length === 0) {
      events.push({ clientX: e.clientX, clientY: e.clientY });
    }

    for (const ev of events) {
      const screenPt = pointOf(ev.clientX, ev.clientY);
      const worldPt = screenToWorld(cameraRef.current, screenPt);

      // Only add if it's far enough from the last point to avoid noise
      const last = state.worldPoints[state.worldPoints.length - 1];
      if (!last || Math.hypot(worldPt.x - last.x, worldPt.y - last.y) > 0.5) {
        state.worldPoints.push(worldPt);
        state.screenPoints.push(screenPt);
      }

      // Check if we've hit STROKE_MAX_POINTS - commit and restart
      if (state.worldPoints.length >= STROKE_MAX_POINTS) {
        const parts = splitPoints(state.worldPoints, STROKE_MAX_POINTS);
        // Commit the first part
        const firstPart = parts[0]!;
        const cam = cameraRef.current;
        const tol = STROKE_SIMPLIFY_TOLERANCE_PX / cam.zoom;
        const simplified = simplify(firstPart, tol);
        undoBoundary();
        createStroke(doc, { points: simplified, color: colorRef.current, thickness: thicknessRef.current }, identityId);
        undoBoundary();

        // Restart with the last point of the committed part
        const lastPt = firstPart[firstPart.length - 1]!;
        const lastScreen = screenPt;
        state.worldPoints = [lastPt];
        state.screenPoints = [lastScreen];
      }
    }

    schedulePreviewUpdate();
  }, [doc, identityId, pointOf, schedulePreviewUpdate, undoBoundary]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = stateRef.current;
    if (!state.active) return;

    const el = containerRef.current;
    if (el?.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }

    finishStroke();
  }, [finishStroke]);

  const onPointerCancel = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  return (
    <div
      ref={containerRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        cursor: 'none',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {previewPath && (
        <svg
          data-testid="pen-preview"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <path
            d={previewPath}
            fill="none"
            stroke={PEN_COLORS[props.color]}
            strokeWidth={PEN_THICKNESS_WORLD[props.thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
