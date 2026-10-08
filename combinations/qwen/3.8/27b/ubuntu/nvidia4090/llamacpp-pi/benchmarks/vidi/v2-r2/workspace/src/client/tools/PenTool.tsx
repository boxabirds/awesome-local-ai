/**
 * Pen tool (story 11, pen.tool): freehand sketching.
 *
 * Implementation notes (design pen.tool, "BoardViewport routes pointer
 * drags to the PenTool"):
 *
 * - `usePenGesture` owns the in-flight stroke: world points captured from
 *   the pointer events BoardViewport routes here (including coalesced
 *   events via getCoalescedEvents where available), the once-per-frame
 *   preview state, and the commit rules:
 *     - pointerup: movement < DRAG_THRESHOLD_PX → a single-point dot
 *       (pen.dot); otherwise the stroke so far, simplified with
 *       STROKE_SIMPLIFY_TOLERANCE_PX / zoom (pen.smooth) and committed
 *       with one createStroke (pen.draw).
 *     - STROKE_MAX_POINTS reached mid-stroke: the part is committed and
 *       the drawing continues as a new stroke from the same last point
 *       (pen.long_stroke).
 *     - pointercancel / lostpointercapture: the points so far are
 *       committed rather than discarded (pen.interrupted).
 *     - null createStroke result → the preview is cleared silently.
 *     - the tool stays active after every commit (pen.stay_active).
 *   Every commit is wrapped in undo boundaries so each stroke (and each
 *   part of a split stroke) is one undo step (undo.boundaries).
 *
 * - `PenTool` is the presentational overlay: the screen-space SVG preview
 *   path (redrawn once per animation frame, never written to the Y.Doc,
 *   so nobody else sees an in-progress stroke — pen.share) and the round
 *   cursor sized thickness × zoom. It is pointer-transparent, so the
 *   BoardViewport's wheel/pinch handlers keep working (pen.navigation).
 *
 * The board owns the hook (it passes camera, options, doc and the undo
 * boundary) and renders <PenTool> with the live preview/cursor state.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
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
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';

/**
 * The gesture callbacks BoardViewport routes pointer events to while the
 * Pen tool is active. `p` is the viewport-local point of the event; the
 * event itself is used for pointer identity and coalesced events.
 */
export interface PenGesture {
  down(e: ReactPointerEvent<Element>, p: Point): void;
  move(e: ReactPointerEvent<Element>, p: Point): void;
  up(e: ReactPointerEvent<Element>, p: Point): void;
  cancel(e: ReactPointerEvent<Element>, p: Point): void;
}

export interface PenGestureOptions {
  /** The pen is armed (tool is 'pen' and the board is editable). */
  active: boolean;
  /** The live camera (the drawing zoom). */
  camera: Camera;
  /** The colour the next stroke uses. */
  color: PenColor;
  /** The thickness the next stroke uses. */
  thickness: PenThickness;
  /** The board's Y.Doc (the commit target). */
  doc: Y.Doc;
  /** The identity that created each stroke. */
  identityId: string;
  /** Closes the undo capture window around each commit (undo.boundaries). */
  onBoundary(): void;
}

export interface PenGestureState {
  /** Route pointer events to these while the pen is active. */
  gesture: PenGesture;
  /** World points of the in-flight stroke (null when not drawing). */
  preview: Point[] | null;
  /** Screen position of the pointer (null until the first movement). */
  cursor: Point | null;
}

/** The in-flight stroke (ref-held; the preview state is a per-frame copy). */
interface StrokeState {
  pointerId: number;
  points: Point[];
  /**
   * Cumulative pointer travel in screen px since the press. The dot
   * threshold (pen.dot) uses this — not the net displacement — so a closed
   * loop that ends near its start is still a stroke, never a dot.
   */
  travelPx: number;
  /** Viewport-local point of the last appended sample. */
  lastLocal: Point;
  /** True once a part was committed mid-stroke (the long-stroke split). */
  split: boolean;
}

export function usePenGesture(options: PenGestureOptions): PenGestureState {
  const { active, doc, onBoundary } = options;

  // Options are read through a ref so the gesture callbacks stay stable
  // (the viewport must not re-bind mid-gesture).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const strokeRef = useRef<StrokeState | null>(null);
  const cursorRef = useRef<Point | null>(null);
  /** Viewport rect captured at pointerdown (converts coalesced client coords). */
  const viewportRectRef = useRef<{ left: number; top: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [frame, setFrame] = useState<{ preview: Point[] | null; cursor: Point | null }>({
    preview: null,
    cursor: null,
  });

  /** Publish the current stroke + cursor state (at most once per frame). */
  const scheduleFrame = useCallback((): void => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const s = strokeRef.current;
      setFrame({
        preview: s === null ? null : s.points.slice(),
        cursor: cursorRef.current,
      });
    });
  }, []);

  /**
   * Commits the current part of `s` (simplify + one createStroke, wrapped
   * in undo boundaries) and restarts the drawing from the same last point
   * (pen.long_stroke: the parts join with no visible gap).
   */
  const commitPart = useCallback((s: StrokeState): void => {
    const o = optionsRef.current;
    const zoom = o.camera.zoom > 0 ? o.camera.zoom : 1;
    const simplified = simplify(s.points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    o.onBoundary();
    const id = createStroke(
      o.doc,
      { points: simplified, color: o.color, thickness: o.thickness },
      o.identityId,
    );
    o.onBoundary();
    if (id === null) {
      // Invalid (practically unreachable: points are finite and the
      // options are validated) — drop the in-flight stroke silently.
      strokeRef.current = null;
      setFrame({ preview: null, cursor: cursorRef.current });
      return;
    }
    s.split = true;
    const last = s.points[s.points.length - 1];
    s.points = [last];
  }, []);

  /** Commits `points` as one stroke (one undo step); null clears silently. */
  const commitPoints = useCallback((points: readonly Point[]): void => {
    if (points.length === 0) {
      return;
    }
    const o = optionsRef.current;
    const zoom = o.camera.zoom > 0 ? o.camera.zoom : 1;
    const simplified = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    o.onBoundary();
    const id = createStroke(
      o.doc,
      { points: simplified, color: o.color, thickness: o.thickness },
      o.identityId,
    );
    o.onBoundary();
    void id; // null → nothing committed; the preview is cleared by the caller
  }, []);

  const down = useCallback(
    (e: ReactPointerEvent<Element>, p: Point): void => {
      if (e.pointerType === 'mouse' && typeof e.button === 'number' && e.button !== 0) {
        return;
      }
      // The viewport rect anchors coalesced-event conversion for this
      // gesture (currentTarget is the BoardViewport element here).
      const ct = e.currentTarget;
      if (ct instanceof Element) {
        const rect = ct.getBoundingClientRect();
        if (Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
          viewportRectRef.current = { left: rect.left, top: rect.top };
        }
      }
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const o = optionsRef.current;
      strokeRef.current = {
        pointerId: e.pointerId,
        points: [screenToWorld(o.camera, p)],
        travelPx: 0,
        lastLocal: { x: p.x, y: p.y },
        split: false,
      };
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const move = useCallback(
    (e: ReactPointerEvent<Element>, p: Point): void => {
      const s = strokeRef.current;
      if (s === null || e.pointerId !== s.pointerId) {
        return;
      }
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const o = optionsRef.current;
      const rect = viewportRectRef.current;
      const appendAt = (clientX: number, clientY: number): void => {
        const local =
          rect !== null
            ? { x: clientX - rect.left, y: clientY - rect.top }
            : p;
        s.travelPx += Math.hypot(local.x - s.lastLocal.x, local.y - s.lastLocal.y);
        s.lastLocal = local;
        s.points.push(screenToWorld(o.camera, local));
        // pen.long_stroke: commit the part and continue from its last point.
        if (s.points.length >= STROKE_MAX_POINTS) {
          commitPart(s);
        }
      };
      // Coalesced events carry the moves the browser batched between frames
      // (high-rate pointers); append them in order, then the main event.
      const ne = e.nativeEvent as
        | { getCoalescedEvents?: () => readonly { clientX: number; clientY: number }[] }
        | null
        | undefined;
      if (ne !== null && ne !== undefined && typeof ne.getCoalescedEvents === 'function') {
        for (const ev of ne.getCoalescedEvents()) {
          appendAt(ev.clientX, ev.clientY);
        }
      }
      appendAt(e.clientX, e.clientY);
      scheduleFrame();
    },
    [commitPart, scheduleFrame],
  );

  const finish = useCallback(
    (e: ReactPointerEvent<Element>, p: Point, cancelled: boolean): void => {
      const s = strokeRef.current;
      if (s === null || e.pointerId !== s.pointerId) {
        return;
      }
      strokeRef.current = null;
      cursorRef.current = { x: e.clientX, y: e.clientY };
      const o = optionsRef.current;
      let points: Point[];
      if (s.travelPx < DRAG_THRESHOLD_PX) {
        // pen.dot: a click without movement commits a single point
        // (cumulative travel: a closed loop is still a stroke).
        points = [screenToWorld(o.camera, p)];
      } else if (s.split && s.points.length === 1) {
        // The pending tail is only the join point of an already-committed
        // part: nothing further to commit.
        points = [];
      } else {
        points = s.points;
      }
      commitPoints(points);
      setFrame({ preview: null, cursor: cursorRef.current });
      void cancelled;
    },
    [commitPoints],
  );

  const up = useCallback(
    (e: ReactPointerEvent<Element>, p: Point): void => {
      finish(e, p, false);
    },
    [finish],
  );

  const cancel = useCallback(
    (e: ReactPointerEvent<Element>, p: Point): void => {
      finish(e, p, true);
    },
    [finish],
  );

  // Hover cursor (pen.tool output): follows the pointer at frame rate while
  // the pen is active, independent of whether a stroke is in flight.
  useEffect(() => {
    if (!active) {
      return;
    }
    const onMove = (e: PointerEvent): void => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
      scheduleFrame();
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
    };
  }, [active, scheduleFrame]);

  // When the pen is disarmed (Escape / another tool mid-stroke) the
  // in-flight stroke is abandoned — it was never written to the document.
  useEffect(() => {
    if (!active) {
      strokeRef.current = null;
      cursorRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setFrame({ preview: null, cursor: null });
    }
  }, [active]);

  // Drop a pending frame on unmount.
  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  return {
    gesture: { down, move, up, cancel },
    preview: frame.preview,
    cursor: frame.cursor,
  };
}

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  /**
   * Kept for the design contract (PenTool(camera, color, thickness, doc,
   * identityId, preview)): commits are made by the usePenGesture the board
   * owns, and the preview is never written to the document.
   */
  doc: Y.Doc;
  identityId: string;
  /** World points of the in-flight stroke (null when not drawing). */
  preview: Point[] | null;
  /** Screen position of the pointer (null until the first movement). */
  cursor: Point | null;
}

/**
 * The pen's screen-space overlay: the live preview path (once per
 * animation frame) and the round cursor sized thickness × zoom.
 * Pointer-transparent (pen.navigation): wheel/scroll still pans.
 */
export function PenTool({ camera, color, thickness, preview, cursor }: PenToolProps): JSX.Element {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const thicknessPx = PEN_THICKNESS_WORLD[thickness] * zoom;
  const ink = PEN_COLORS[color];

  let d = '';
  if (preview !== null && preview.length > 0) {
    const screen = preview.map((p) => worldToScreen(camera, p));
    d = smoothPath(screen);
  }

  return (
    <div
      data-testid="pen-tool-layer"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1500,
        pointerEvents: 'none',
      }}
    >
      {d !== '' && (
        <svg
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          <path
            data-testid="pen-preview"
            d={d}
            fill="none"
            stroke={ink}
            strokeWidth={thicknessPx}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor !== null && (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'absolute',
            left: cursor.x,
            top: cursor.y,
            width: thicknessPx,
            height: thicknessPx,
            marginLeft: -thicknessPx / 2,
            marginTop: -thicknessPx / 2,
            borderRadius: '50%',
            border: `1.5px solid ${ink}`,
            background: 'rgba(255,255,255,0.35)',
            boxSizing: 'border-box',
          }}
        />
      )}
    </div>
  );
}
