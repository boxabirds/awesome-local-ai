// Pen tool (story 11): freehand drawing.
//
// Captures coalesced pointer points into a local, never-synced preview; on
// release (or cancel, or reaching STROKE_MAX_POINTS) the points are
// simplified with RDP at a zoom-scaled tolerance and committed as one stroke
// object via createStroke (a single LOCAL_ORIGIN transaction). The in-
// progress stroke is a local overlay only — nobody else sees it while it is
// being drawn. The Pen tool stays active after each stroke.
//
// The tool renders a full-viewport fixed overlay so drags starting over
// existing objects are captured here (they never pan the board or move
// objects). Wheel events over the overlay are forwarded to the camera, so
// scrolling still pans and Ctrl/Cmd+scroll zooms while the Pen is active.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  WHEEL_LINE_DELTA_PX,
  WHEEL_PAGE_DELTA_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';
import { screenToWorld } from '../canvas/camera';
import { useCameraContext } from '../canvas/BoardViewport';
import type * as Y from 'yjs';

export interface PenToolProps {
  camera: { x: number; y: number; zoom: number };
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Undo boundary callback (before/after each commit). */
  onBoundary?: () => void;
}

export function PenTool({ camera, color, thickness, doc, identityId, onBoundary }: PenToolProps): React.ReactElement {
  const api = useCameraContext();
  const wheelCb = api.wheel;

  const [points, setPoints] = useState<Point[] | null>(null);
  const pointsRef = useRef<Point[]>([]);
  const downRef = useRef<{ x: number; y: number } | null>(null); // screen px
  const rafRef = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Latest values, read inside event handlers.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const optsRef = useRef({ color, thickness, doc, identityId, onBoundary });
  optsRef.current = { color, thickness, doc, identityId, onBoundary };

  // --- Preview: redraw at most once per animation frame ---

  const schedulePreview = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setPoints(pointsRef.current.slice());
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // --- Commit: simplify (or keep a single dot) and create the stroke ---

  const commit = useCallback((pts: Point[]) => {
    const { doc, identityId, onBoundary, color, thickness } = optsRef.current;
    if (pts.length === 0) return;
    const final =
      pts.length === 1
        ? pts
        : simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / cameraRef.current.zoom);
    onBoundary?.();
    const id = createStroke(doc, { points: final, color, thickness }, identityId);
    onBoundary?.();
    if (id === null) return; // rejected stroke: preview already cleared, nothing else
  }, []);

  const finish = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      if (pointsRef.current.length === 0 || downRef.current === null) return;
      e.stopPropagation();
      const down = downRef.current;
      const pts = pointsRef.current;
      downRef.current = null;
      pointsRef.current = [];
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setPoints(null);
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (!cancelled && moved < DRAG_THRESHOLD_PX) {
        // A click without movement draws a round dot.
        commit([screenToWorld(cameraRef.current, { x: down.x, y: down.y })]);
      } else {
        // Release — or an interruption (pointercancel / lost pointer
        // capture): keep the points drawn so far.
        commit(pts);
      }
    },
    [commit],
  );

  // --- Pointer handlers (routed from the full-viewport overlay) ---

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const world = screenToWorld(cameraRef.current, { x: e.clientX, y: e.clientY });
      downRef.current = { x: e.clientX, y: e.clientY };
      pointsRef.current = [world];
      schedulePreview();
    },
    [schedulePreview],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pointsRef.current.length === 0 || downRef.current === null) return;
      e.stopPropagation();
      const cam = cameraRef.current;
      // Coalesced events carry the intermediate pointer samples the browser
      // batched since the last frame.
      const coalesced =
        typeof e.nativeEvent.getCoalescedEvents === 'function'
          ? e.nativeEvent.getCoalescedEvents()
          : [];
      const events = coalesced.length > 0 ? coalesced : [e.nativeEvent];
      for (const ev of events) {
        pointsRef.current.push(screenToWorld(cam, { x: ev.clientX, y: ev.clientY }));
        // Very long strokes: finish this part and continue as a new stroke
        // starting at the same last point (no visible gap).
        if (pointsRef.current.length >= STROKE_MAX_POINTS) {
          const part = pointsRef.current;
          const last = part[part.length - 1];
          pointsRef.current = [last];
          commit(part);
        }
      }
      schedulePreview();
    },
    [commit, schedulePreview],
  );

  // --- Wheel: pan / zoom while the Pen is active (the overlay covers the
  //     viewport, so forward the same normalised wheel input to the camera).

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= WHEEL_LINE_DELTA_PX;
        dy *= WHEEL_LINE_DELTA_PX;
      } else if (e.deltaMode === 2) {
        dx *= WHEEL_PAGE_DELTA_PX;
        dy *= WHEEL_PAGE_DELTA_PX;
      }
      wheelCb({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheelCb]);

  // --- Preview + cursor ---

  const ox = -camera.x * camera.zoom;
  const oy = -camera.y * camera.zoom;
  const d = points !== null ? smoothPath(points) : '';
  const cursorSize = Math.max(4, Math.round(PEN_THICKNESS_WORLD[thickness] * camera.zoom));
  const cursorSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cursorSize}" height="${cursorSize}"><circle cx="${cursorSize / 2}" cy="${cursorSize / 2}" r="${Math.max(1, cursorSize / 2 - 1)}" fill="none" stroke="rgba(0,0,0,0.75)" stroke-width="1"/></svg>`;

  return (
    <div
      ref={ref}
      data-testid="pen-tool"
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'auto',
        zIndex: 10,
        cursor: `url("data:image/svg+xml,${encodeURIComponent(cursorSvg)}") ${cursorSize / 2} ${
          cursorSize / 2
        }, crosshair`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
    >
      {points !== null && points.length > 0 && (
        <svg
          data-testid="pen-preview"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          <g transform={`translate(${ox} ${oy}) scale(${camera.zoom})`}>
            <path
              d={d}
              fill="none"
              stroke={PEN_COLORS[color]}
              strokeWidth={PEN_THICKNESS_WORLD[thickness]}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </svg>
      )}
    </div>
  );
}
