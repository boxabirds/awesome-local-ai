import {
  useCallback,
  useEffect,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { PenColor, PenThickness } from '../../shared/config';
import {
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type { Camera } from '../canvas/camera';
import { clientToWorld } from '../canvas/viewportPoint';
import { useBoardDoc } from '../board/useBoardDoc';
import { useIdentity } from '../board/useIdentity';
import { useUndoController } from '../board/UndoContext';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
}

/**
 * The Pen tool (story 11): captures pointer points into a local preview (never
 * written to the doc, so others don't see in-progress strokes). On release,
 * cancels or reaching STROKE_MAX_POINTS, simplifies and commits via createStroke.
 *
 * The tool stays active after each commit — the user must explicitly switch tools.
 */
export function PenTool({ camera, color, thickness }: PenToolProps): JSX.Element {
  const { doc } = useBoardDoc();
  const identity = useIdentity();
  const undo = useUndoController();

  const pointsRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);
  const startWorldRef = useRef<Point | null>(null);
  const svgPathRef = useRef<SVGPathElement | null>(null);
  const cameraRef = useRef(camera);
  const colorRef = useRef(color);
  const thicknessRef = useRef(thickness);

  useEffect(() => { cameraRef.current = camera; });
  useEffect(() => { colorRef.current = color; });
  useEffect(() => { thicknessRef.current = thickness; });

  const updatePreviewPath = useCallback((): void => {
    const path = svgPathRef.current;
    if (path === null) return;
    const pts = pointsRef.current;
    if (pts.length === 0) {
      path.setAttribute('d', '');
      return;
    }
    const cam = cameraRef.current;
    const screenPoints: Point[] = pts.map((p) => ({
      x: (p.x - cam.x) * cam.zoom,
      y: (p.y - cam.y) * cam.zoom,
    }));
    path.setAttribute('d', smoothPath(screenPoints));
  }, []);

  const commitPart = useCallback(
    (pts: Point[]): void => {
      if (pts.length === 0) return;
      const zoom = cameraRef.current.zoom;
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
      const simplified = pts.length === 1 ? pts : simplify(pts, tolerance);
      undo?.boundary();
      createStroke(
        doc,
        { points: simplified, color: colorRef.current, thickness: thicknessRef.current },
        identity.id,
      );
      undo?.boundary();
    },
    [doc, identity.id, undo],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const el = event.currentTarget;
      try { el.setPointerCapture(event.pointerId); } catch { /* best-effort */ }
      drawingRef.current = true;
      const world = clientToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
      pointsRef.current = [world];
      startWorldRef.current = world;
      updatePreviewPath();
    },
    [updatePreviewPath],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return;
      event.stopPropagation();
      // Coalesced events: use the native event when it supports
      // `getCoalescedEvents()` (real browsers); otherwise just use the
      // synthetic event's own coordinates (jsdom, tests).
      const native: any = event.nativeEvent;
      if (native != null && typeof native.getCoalescedEvents === 'function') {
        const coalesced: { clientX: number; clientY: number }[] = native.getCoalescedEvents();
        if (coalesced.length > 0) {
          for (const pt of coalesced) {
            const world = clientToWorld(cameraRef.current, { x: pt.clientX, y: pt.clientY });
            pointsRef.current.push(world);
          }
        } else {
          // getCoalescedEvents() returned empty; fall through to single-point
          const world = clientToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
          pointsRef.current.push(world);
        }
      } else {
        const world = clientToWorld(cameraRef.current, { x: event.clientX, y: event.clientY });
        pointsRef.current.push(world);
      }

      // Check STROKE_MAX_POINTS: commit current batch and restart from last point
      if (pointsRef.current.length >= STROKE_MAX_POINTS) {
        const pts = pointsRef.current.slice();
        commitPart(pts);
        pointsRef.current = [pts[pts.length - 1]!];
      }

      updatePreviewPath();
    },
    [commitPart, updatePreviewPath],
  );

  const finishStroke = useCallback((): void => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pts = pointsRef.current;
    pointsRef.current = [];
    startWorldRef.current = null;
    if (svgPathRef.current) svgPathRef.current.setAttribute('d', '');
    if (pts.length === 0) return;
    // Click (below drag threshold): use single point
    if (pts.length === 1) {
      commitPart(pts);
      return;
    }
    // Check screen-space distance between first and last point
    const cam = cameraRef.current;
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const dx = (last.x - first.x) * cam.zoom;
    const dy = (last.y - first.y) * cam.zoom;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      commitPart([first]);
    } else {
      commitPart(pts);
    }
  }, [commitPart]);

  const handlePointerUp = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {
      finishStroke();
    },
    [finishStroke],
  );

  const handlePointerCancel = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {
      finishStroke();
    },
    [finishStroke],
  );

  const handleLostPointerCapture = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {
      finishStroke();
    },
    [finishStroke],
  );

  return (
    <div
      data-testid="pen-tool-layer"
      className="tool-layer"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        cursor: 'crosshair',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <svg
        data-testid="pen-preview"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        <path
          ref={svgPathRef}
          d=""
          fill="none"
          stroke={color}
          strokeWidth={PEN_THICKNESS_WORLD[thickness]}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
