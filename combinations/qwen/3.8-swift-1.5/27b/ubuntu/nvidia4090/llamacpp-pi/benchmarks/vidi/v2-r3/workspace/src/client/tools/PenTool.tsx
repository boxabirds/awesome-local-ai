import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import type * as Y from 'yjs';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Forwards wheel/pinch from the overlay to the camera (pen.navigation). */
  wheel?: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  /** Called after each committed stroke (one undo step per stroke). */
  onCommitted?: () => void;
}

/**
 * The Pen tool (story 11, pen). A full-screen overlay that captures pointer
 * drags into a local, never-synced preview; on release the points are
 * simplified (RDP, 1 px at the current zoom) and committed as ONE stroke
 * object. Interrupted strokes (pointercancel) are kept; a tap without
 * movement commits a single point (a dot). Very long strokes commit in
 * parts of STROKE_MAX_POINTS each, sharing the join point.
 *
 * The pen stays active after each stroke (pen.tool_state). Wheel and pinch
 * events are forwarded to the camera so scrolling pans and Ctrl/Cmd+scroll
 * zooms while the pen is active (pen.navigation); the viewport must not
 * pan, marquee, create, or clear on pointer drags while the pen is active.
 */
export function PenTool({
  camera,
  color,
  thickness,
  doc,
  identityId,
  wheel,
  onCommitted,
}: PenToolProps): ReactElement {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  const pointsRef = useRef<Point[]>([]);
  const drawingRef = useRef(false);
  const startScreenRef = useRef<Point | null>(null);
  const lastScreenRef = useRef<Point | null>(null);
  const rafRef = useRef(0);

  // Latest props in refs (stable native-style handlers).
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const wheelRef = useRef(wheel);
  wheelRef.current = wheel;
  const onCommittedRef = useRef(onCommitted);
  onCommittedRef.current = onCommitted;

  const renderPreview = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) {
      setPreviewPath(null);
      return;
    }
    const cam = cameraRef.current;
    setPreviewPath(smoothPath(pts.map((p) => worldToScreen(cam, p))));
  }, []);

  const schedulePreview = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderPreview();
    });
  }, [renderPreview]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /**
   * Simplify + commit `pts` as one stroke object. A tap (no movement)
   * commits a single point (a dot). `start`/`end` (screen points) may be
   * passed explicitly (on finish the gesture refs are cleared first).
   */
  const commitPoints = useCallback(
    (pts: Point[], start?: Point | null, end?: Point | null) => {
      if (pts.length === 0) return;
      const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
      const startPt = start ?? startScreenRef.current;
      const endPt = end ?? lastScreenRef.current;
      const moved =
        pts.length > 1 &&
        startPt !== null &&
        endPt !== null &&
        Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) >= DRAG_THRESHOLD_PX;
      const toCommit = moved
        ? simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / zoom)
        : [{ x: pts[0].x, y: pts[0].y }];
      const id = createStroke(
        doc,
        { points: toCommit, color: colorRef.current, thickness: thicknessRef.current },
        identityId,
      );
      if (id !== null) onCommittedRef.current?.();
    },
    [doc, identityId],
  );

  /** End the current drag: keep what was drawn (pen.interrupted). */
  const finishStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pts = pointsRef.current;
    const start = startScreenRef.current;
    const end = lastScreenRef.current;
    pointsRef.current = [];
    startScreenRef.current = null;
    lastScreenRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setPreviewPath(null);
    setCursor(null);
    if (pts.length > 0) commitPoints(pts, start, end);
  }, [commitPoints]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.nativeEvent.button !== 0) return;
      const el = overlayRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* jsdom / synthetic pointers */
      }
      const rect = el.getBoundingClientRect();
      const screen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const world = screenToWorld(cameraRef.current, screen);
      drawingRef.current = true;
      startScreenRef.current = screen;
      lastScreenRef.current = screen;
      pointsRef.current = [world];
      setCursor(screen);
      schedulePreview();
    },
    [schedulePreview],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const el = overlayRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const screen: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (!drawingRef.current) {
        setCursor(screen);
        return;
      }
      lastScreenRef.current = screen;
      // High-frequency input: use coalesced events when available.
      const ne = e.nativeEvent as PointerEvent;
      const events: PointerEvent[] =
        typeof ne.getCoalescedEvents === 'function'
          ? ne.getCoalescedEvents().length > 0
            ? ne.getCoalescedEvents()
            : [ne]
          : [ne];
      const cam = cameraRef.current;
      for (const ev of events) {
        const s: Point = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
        pointsRef.current.push(screenToWorld(cam, s));
      }
      // Very long strokes: commit the part at STROKE_MAX_POINTS and keep
      // drawing (the next part starts at the same point).
      if (pointsRef.current.length >= STROKE_MAX_POINTS) {
        const part = pointsRef.current.slice(0, STROKE_MAX_POINTS);
        const last = part[part.length - 1];
        pointsRef.current = [{ x: last.x, y: last.y }];
        commitPoints(part);
      }
      schedulePreview();
    },
    [commitPoints, schedulePreview],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const el = overlayRef.current;
      if (el) {
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* noop */
        }
      }
      finishStroke();
    },
    [finishStroke],
  );

  // Interrupted strokes are kept (pen.interrupted): pointercancel and lost
  // pointer capture both finish the stroke with the points drawn so far.
  const handlePointerCancel = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  const handleLostCapture = useCallback(() => {
    finishStroke();
  }, [finishStroke]);

  // Wheel + pinch forward to the camera (pen.navigation): the overlay sits
  // above the viewport, so wheel events targeting it never reach the
  // viewport's own (non-passive) listener.
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const LINE_HEIGHT = 16;
      const PAGE_HEIGHT = 100;
      const scale = e.deltaMode === 1 ? LINE_HEIGHT : e.deltaMode === 2 ? PAGE_HEIGHT : 1;
      const rect = el.getBoundingClientRect();
      wheelRef.current?.({
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const t = PEN_THICKNESS_WORLD[thickness];
  const cursorSize = Math.max(4, t * camera.zoom);

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 15,
        cursor: 'none',
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostCapture}
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {previewPath && (
          <path
            data-testid="pen-preview"
            d={previewPath}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={t * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      {cursor && (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'absolute',
            left: cursor.x - cursorSize / 2,
            top: cursor.y - cursorSize / 2,
            width: cursorSize,
            height: cursorSize,
            borderRadius: '50%',
            border: `1px solid ${PEN_COLORS[color]}`,
            background: 'transparent',
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
