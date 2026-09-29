import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '@/shared/config';
import type { Point } from '@/shared/geometry';
import { simplify } from '@/shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '@/shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

/**
 * Pen tool (story 11): freehand strokes, client-local until the stroke
 * finishes (pen.draw). One component instance per active session — it is
 * mounted by the Board only while the pen tool is active and the board is
 * editable.
 *
 * Gesture (one primary pointer at a time; see the state diagram in design.md):
 * - pointerdown (left button) on the viewport or on any object: begin a
 *   stroke. The press never pans, moves, or edits anything below (the
 *   viewport and the object wrappers route the press here while the pen is
 *   active). The element that received the press captures the pointer.
 * - pointermove: raw points are appended in WORLD coordinates (coalesced
 *   events included, so fast strokes do not alias). When a stroke reaches
 *   STROKE_MAX_POINTS it is committed and continued as a new stroke from the
 *   shared join point (pen.long_stroke).
 * - pointerup: a press that moved less than DRAG_THRESHOLD_PX commits a
 *   single-point round dot (pen.dot); otherwise the stroke is committed with
 *   RDP smoothing (tolerance STROKE_SIMPLIFY_TOLERANCE_PX / zoom, pen.smooth).
 *   The pen stays active (no toolCreated).
 * - pointercancel / lostpointercapture: commit the points drawn so far
 *   (pen.interrupt).
 *
 * The live preview is a pointer-events-none SVG overlay redrawn at most once
 * per animation frame (rAF), so a drag redraws it at least once per displayed
 * frame. The preview follows the camera (pan/zoom mid-stroke is fine).
 *
 * Each commit emits exactly one LOCAL_ORIGIN transaction (via createStroke)
 * wrapped in an undo boundary (story 8).
 */
export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Story 8: undo/redo boundary, called before and after each commit. */
  onBoundary?(): void;
  /**
   * Registers the pointer-down handler. The Board passes it to the viewport
   * (onPenDown) and to the object pointer-down wrapper, so a press anywhere
   * on the board starts a stroke.
   */
  onDownReady(handler: (e: ReactPointerEvent) => void): void;
}

/** Local helper: raw polyline path (the preview follows the pointer exactly). */
function polylinePath(pts: readonly Point[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i += 1) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

export function PenTool(props: PenToolProps): ReactElement {
  const [preview, setPreview] = useState<Point[] | null>(null);

  // Gesture state lives in refs: pointer events are high-frequency and must
  // not wait for React renders.
  const pointsRef = useRef<Point[] | null>(null);
  const downClientRef = useRef<Point | null>(null);
  const lastClientRef = useRef<Point | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // Always-fresh props for the window listeners (camera can change mid-stroke).
  const propsRef = useRef(props);
  propsRef.current = props;

  const commitStroke = useCallback((pts: readonly Point[], asDot: boolean): void => {
    const p = propsRef.current;
    p.onBoundary?.();
    if (asDot || pts.length === 1) {
      createStroke(p.doc, { points: [pts[0]], color: p.color, thickness: p.thickness }, p.identityId);
    } else {
      const zoom = Math.max(p.camera.zoom, 1e-6);
      const simplified = simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
      createStroke(p.doc, { points: simplified, color: p.color, thickness: p.thickness }, p.identityId);
    }
    p.onBoundary?.();
  }, []);

  const clearGesture = useCallback((): void => {
    pointsRef.current = null;
    downClientRef.current = null;
    lastClientRef.current = null;
    pointerIdRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPreview(null);
  }, []);

  const finishStroke = useCallback(
    (allowDot: boolean): void => {
      const pts = pointsRef.current;
      const down = downClientRef.current;
      const last = lastClientRef.current;
      clearGesture();
      if (pts === null || pts.length === 0) return;
      let asDot = pts.length === 1;
      if (!asDot && allowDot && down !== null && last !== null) {
        asDot = Math.hypot(last.x - down.x, last.y - down.y) < DRAG_THRESHOLD_PX;
      }
      commitStroke(pts, asDot);
    },
    [clearGesture, commitStroke],
  );

  const startDraw = useCallback(
    (e: ReactPointerEvent): void => {
      if (e.button !== 0) return;
      if (pointerIdRef.current !== null) return; // one stroke at a time
      e.preventDefault();
      const cam = propsRef.current.camera;
      const p = screenToWorld(cam, { x: e.clientX, y: e.clientY });
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      pointsRef.current = [p];
      downClientRef.current = { x: e.clientX, y: e.clientY };
      lastClientRef.current = { x: e.clientX, y: e.clientY };
      pointerIdRef.current = e.pointerId;
      setPreview([p]);
      // Capture on the element that received the press (viewport or object).
      const el = e.currentTarget as Element | null;
      try {
        el?.setPointerCapture?.(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    },
    [],
  );

  // Expose the press handler to the Board (viewport + object routing).
  useEffect(() => {
    props.onDownReady(startDraw);
    return () => props.onDownReady(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDraw]);

  // Window-level listeners: they fire for captured pointers no matter where
  // the pointer goes (off-window, over other panes, etc.).
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== pointerIdRef.current) return;
      const pts = pointsRef.current;
      if (pts === null) return;
      const cam = propsRef.current.camera;
      // Coalesced events carry the full path the pointer took (fast strokes).
      let events: Array<{ clientX: number; clientY: number }>;
      try {
        events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      } catch {
        events = [e];
      }
      if (events.length === 0) events = [e];
      for (const ev of events) {
        const p = screenToWorld(cam, { x: ev.clientX, y: ev.clientY });
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p);
      }
      lastClientRef.current = { x: e.clientX, y: e.clientY };
      // pen.long_stroke: finish the full part and continue from the shared
      // join point (its last point becomes this stroke's first point).
      if (pts.length >= STROKE_MAX_POINTS) {
        const part = pts.slice(0, STROKE_MAX_POINTS);
        const rest = pts.slice(STROKE_MAX_POINTS);
        commitStroke(part, false);
        pts.length = 0;
        pts.push(part[part.length - 1], ...rest);
      }
      // Redraw the preview at most once per animation frame.
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const cur = pointsRef.current;
          if (cur !== null) setPreview(cur.slice());
        });
      }
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== pointerIdRef.current) return;
      finishStroke(true);
    };
    const onCancel = (e: PointerEvent): void => {
      if (e.pointerId !== pointerIdRef.current) return;
      finishStroke(true);
    };
    const onLostCapture = (e: PointerEvent): void => {
      if (e.pointerId !== pointerIdRef.current) return;
      finishStroke(true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('lostpointercapture', onLostCapture);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('lostpointercapture', onLostCapture);
      // Unmount mid-stroke (Escape / tool switch): discard, no commit.
      clearGesture();
    };
  }, [commitStroke, clearGesture, finishStroke]);

  // --- Live preview (pointer-events none; the board stays fully live). ---
  const cam = props.camera;
  const color = PEN_COLORS[props.color];
  const widthWorld = PEN_THICKNESS_WORLD[props.thickness];
  let content: ReactElement | null = null;
  if (preview !== null && preview.length > 0) {
    const screen = preview.map((p) => worldToScreen(cam, p));
    if (preview.length === 1) {
      content = (
        <circle
          data-testid="pen-preview-dot"
          cx={screen[0].x}
          cy={screen[0].y}
          r={(widthWorld * cam.zoom) / 2}
          fill={color}
        />
      );
    } else {
      content = (
        <path
          data-testid="pen-preview-path"
          d={polylinePath(screen)}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(0.5, widthWorld * cam.zoom)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }
  }

  return (
    <div
      data-testid="pen-preview"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        {content}
      </svg>
    </div>
  );
}

/**
 * Pen cursor (pen.options): a ring sized to the current line thickness at the
 * current zoom (screen pixels, clamped to a visible minimum), plus a
 * crosshair fallback. Used by the Board viewport while the pen is active.
 */
export function penCursor(thickness: PenThickness, zoom: number): string {
  const size = Math.max(3, Math.round(PEN_THICKNESS_WORLD[thickness] * zoom));
  const half = size / 2;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<circle cx='${half}' cy='${half}' r='${Math.max(0.5, half - 0.5)}' fill='rgba(0,0,0,0.06)' stroke='rgba(0,0,0,0.75)' stroke-width='1'/>` +
    `</svg>`;
  return `${half}px ${half}px url("data:image/svg+xml,${encodeURIComponent(svg)}") crosshair`;
}
