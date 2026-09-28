// The Pen tool (story 11, pen.draw / pen.dot / pen.long_stroke /
// pen.interrupted / pen.stay_active): captures pointer drags routed from the
// BoardViewport while the tool is active, records coalesced pointer points
// in world space and shows a LOCAL, never-synced screen-space preview
// (redrawn once per animation frame) — others see a stroke only when it is
// finished (pen.share).
//
// On release (or cancel / lost capture) the points are simplified with
// Ramer–Douglas–Peucker at STROKE_SIMPLIFY_TOLERANCE_PX / zoom and committed
// as ONE stroke object in a single LOCAL_ORIGIN transaction (one undo step).
// A click without movement (< DRAG_THRESHOLD_PX screen) commits a round dot;
// a drag reaching STROKE_MAX_POINTS raw points commits the part and restarts
// at its last point (pen.long_stroke). The tool STAYS active after each
// stroke (pen.stay_active) — Escape or another tool shortcut switches away.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';

export interface PenToolProps {
  /** The shared camera (screen ↔ world); read live on every event. */
  camera: Camera;
  /** The chosen pen colour (session state, usePenOptions). */
  color: PenColor;
  /** The chosen pen thickness name (session state, usePenOptions). */
  thickness: PenThickness;
  /** The board doc (finished strokes are written here). */
  doc: Y.Doc;
  /** The creator identity (createdBy). */
  identityId: string;
  /** Undo boundary marker: one finished stroke = one undo step. */
  onBoundary(): void;
  /** A finished stroke was committed (the board selects it, the tool stays
   *  active — pen.stay_active). */
  onCreated(id: string): void;
}

/** The pointer-gesture entry points, routed from the BoardViewport while
 *  the Pen tool is active (pen.navigation: drags never pan the board). */
export interface PenToolApi {
  pointerDown(e: ReactPointerEvent): void;
  pointerMove(e: ReactPointerEvent): void;
  pointerUp(e: ReactPointerEvent): void;
  pointerCancel(e: ReactPointerEvent): void;
  pointerLeave(): void;
}

interface PreviewState {
  /** The screen-space preview path (empty while idle). */
  path: string;
  /** The round cursor position (viewport-local px), null off-board. */
  cursor: Point | null;
}

export const PenTool = forwardRef<PenToolApi, PenToolProps>(function PenTool(props, ref) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PreviewState>({ path: '', cursor: null });

  // Live values behind the imperative API (stable listeners).
  const propsRef = useRef(props);
  propsRef.current = props;
  const drawingRef = useRef<Point[] | null>(null);
  const startScreenRef = useRef<Point | null>(null);
  const cursorRef = useRef<Point | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingCursorRef = useRef<Point | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }): Point => {
    const rect = overlayRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /** One preview repaint: the accumulated world points → screen path. */
  const repaint = useCallback((): void => {
    rafRef.current = null;
    const { camera } = propsRef.current;
    const pts = drawingRef.current;
    const path =
      pts !== null && pts.length > 0
        ? smoothPath(pts.map((p) => worldToScreen(camera, p)))
        : '';
    setPreview({ path, cursor: pendingCursorRef.current ?? cursorRef.current });
  }, []);

  const scheduleRepaint = useCallback((): void => {
    if (rafRef.current === null) {
      // At most one repaint per animation frame (pen.draw).
      rafRef.current = requestAnimationFrame(repaint);
    }
  }, [repaint]);

  const setCursor = (p: Point | null): void => {
    cursorRef.current = p;
    pendingCursorRef.current = p;
    scheduleRepaint();
  };

  /** Commits `pts` (world) as one stroke (or a dot for a single point);
   *  null results clear the preview silently (pen.* error paths). */
  const commitPart = (pts: Point[]): void => {
    if (pts.length === 0) return;
    const { doc, color, thickness, identityId, onBoundary, onCreated } = propsRef.current;
    const zoom = propsRef.current.camera.zoom;
    // One finished stroke (or split part) is one undo step (undo.steps).
    onBoundary();
    const toCreate =
      pts.length === 1 ? pts : simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    const id = createStroke(doc, { points: toCreate, color, thickness }, identityId);
    onBoundary();
    if (id === null) {
      // Invalid input: discard silently (no transaction was opened).
      drawingRef.current = null;
      setPreview({ path: '', cursor: cursorRef.current });
      return;
    }
    // A finished stroke is selected (the standard selectCreated path);
    // the tool stays the Pen (pen.stay_active).
    onCreated(id);
  };

  const pointerDown = useCallback((e: ReactPointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const { camera } = propsRef.current;
    const local = toLocal(e);
    startScreenRef.current = local;
    drawingRef.current = [screenToWorld(camera, local)];
    setCursor(local);
  }, []);

  const pointerMove = useCallback(
    (e: ReactPointerEvent): void => {
      const local = toLocal(e);
      setCursor(local);
      const pts0 = drawingRef.current;
      if (pts0 === null) return;
      let pts = pts0;
      const { camera } = propsRef.current;
      // Coalesced events keep the line faithful on fast drags (pen.draw);
      // fall back to the single event where unavailable (jsdom).
      const events: (PointerEvent | ReactPointerEvent)[] =
        typeof e.nativeEvent.getCoalescedEvents === 'function'
          ? e.nativeEvent.getCoalescedEvents()
          : [e.nativeEvent];
      for (const ev of events) {
        if (pts.length >= STROKE_MAX_POINTS) {
          // Long stroke: this part is FULL — finish it and restart at its
          // last point so the parts join seamlessly (pen.long_stroke). A
          // drag of exactly STROKE_MAX_POINTS points never splits.
          const part = pts.slice();
          drawingRef.current = [part[part.length - 1]];
          commitPart(part);
          if (drawingRef.current === null) return; // commit rejected
          pts = drawingRef.current;
        }
        const p = screenToWorld(camera, toLocal(ev as { clientX: number; clientY: number }));
        pts.push(p);
      }
      scheduleRepaint();
    },
    [scheduleRepaint],
  );

  const finish = (e: ReactPointerEvent, interrupted: boolean): void => {
    const pts = drawingRef.current;
    if (pts === null) return;
    const { camera } = propsRef.current;
    const local = toLocal(e);
    startScreenRef.current = null;
    if (!interrupted && pts.length === 1) {
      // A click without movement (< DRAG_THRESHOLD_PX) draws a dot at the
      // pressed point (pen.dot).
      const start = startScreenRef.current ?? local;
      const dist = Math.hypot(local.x - start.x, local.y - start.y);
      if (dist < DRAG_THRESHOLD_PX) {
        drawingRef.current = null;
        setCursor(local);
        scheduleRepaint();
        commitPart([pts[0]]);
        return;
      }
    }
    pts.push(screenToWorld(camera, local));
    drawingRef.current = null;
    setCursor(local);
    scheduleRepaint();
    commitPart(pts);
  };

  useImperativeHandle(
    ref,
    (): PenToolApi => ({
      pointerDown,
      pointerMove,
      pointerUp: (e) => finish(e, false),
      pointerCancel: (e) => finish(e, true),
      pointerLeave: () => setCursor(null),
    }),
    [pointerDown, pointerMove],
  );

  // Cancel a pending repaint on unmount (a mid-drag unmount keeps the
  // stroke local-only; nothing is persisted until commit).
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const { camera, color, thickness } = props;
  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const cursorSize = thicknessWorld * camera.zoom;

  return (
    <div
      ref={overlayRef}
      className="pen-tool"
      data-testid="pen-tool"
      style={{ cursor: 'none' }}
      aria-hidden="true"
    >
      {preview.path !== '' && (
        <svg className="pen-tool-preview" data-testid="pen-preview" width="100%" height="100%">
          <path
            d={preview.path}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={thicknessWorld * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {preview.cursor !== null && (
        <div
          className="pen-cursor"
          data-testid="pen-cursor"
          style={{
            left: preview.cursor.x - cursorSize / 2,
            top: preview.cursor.y - cursorSize / 2,
            width: cursorSize,
            height: cursorSize,
          }}
        />
      )}
    </div>
  );
});
