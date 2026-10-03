/**
 * The Pen tool: hold the pointer down and draw (`pen.capture`, `pen.stroke`, `pen.commit`).
 *
 * While the pointer is down, every sample of its path — including the high-frequency points the
 * browser coalesces into one move event (`getCoalescedEvents`) — is recorded in world coordinates
 * and mirrored on screen as a live preview. The preview is a local overlay: it is never written to
 * the document, so a colleague sees a stroke appear only when it is finished (`pen.commit`), and a
 * refresh or a leave discards it.
 *
 * Releasing finishes the stroke: the recorded path is simplified and written as a stroke object,
 * one undo step, and the tool stays armed for the next one (`pen.commit`). Releasing past the edge
 * of the window, or losing the pointer, keeps the points gathered so far. A movement of under
 * `DRAG_THRESHOLD_PX` is a click and draws a single point. A path that runs past
 * `STROKE_MAX_POINTS` is written in parts, each its own stroke, so the sketch is never lost to a
 * cap (`stroke.split`).
 *
 * The overlay is a child of the viewport, so a wheel gesture over it still pans and zooms the
 * board (`pen.tool_ui`): a pen does not freeze the view. The pointer itself becomes a round cursor
 * the size of the current thickness (`pen.capture`).
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
import type { Point } from '../../shared/geometry';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /**
   * Close the current undo capture window, so a stroke is a step of its own
   * (`stroke.undo`). Called immediately before and after each write.
   */
  onCommitBoundary?(): void;
}

/** A screen point plus a finite guard, so a stray NaN never reaches the preview. */
function screenPoint(x: number, y: number): Point | null {
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function PenTool({
  camera,
  color,
  thickness,
  doc,
  identityId,
  onCommitBoundary,
}: PenToolProps) {
  // The raw world path of the part currently being drawn; null when the pen is up.
  const drawingRef = useRef<Point[] | null>(null);
  const startScreenRef = useRef<Point>({ x: 0, y: 0 });
  const lastScreenRef = useRef<Point>({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  // The preview, in screen points, refreshed at most once per animation frame.
  const [preview, setPreview] = useState<Point[] | null>(null);
  // Where the pointer is, so the round pen tip follows it (even while merely hovering).
  const [cursor, setCursor] = useState<Point | null>(null);

  // The camera and options are read through a ref so the pointer handlers stay stable across
  // renders while always using the current zoom, colour and thickness.
  const live = useRef({ camera, color, thickness });
  live.current = { camera, color, thickness };

  const ink = PEN_COLORS[color];
  const tipSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;

  const releaseCapture = useCallback((target: EventTarget | null) => {
    const id = pointerIdRef.current;
    if (id !== null && target instanceof Element && target.hasPointerCapture?.(id)) {
      target.releasePointerCapture(id);
    }
    pointerIdRef.current = null;
  }, []);

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const drawing = drawingRef.current;
      if (!drawing) {
        setPreview(null);
        return;
      }
      const { camera: cam } = live.current;
      setPreview(drawing.map((p) => worldToScreen(cam, p)));
    });
  }, []);

  /** Simplify `points` to within one screen pixel and write a stroke — one undo step. */
  const commit = useCallback(
    (points: Point[]) => {
      if (points.length === 0) return;
      const zoom = live.current.camera.zoom || 1;
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
      const reduced = simplify(points, tolerance);
      onCommitBoundary?.();
      createStroke(doc, { points: reduced, color: live.current.color, thickness: live.current.thickness }, identityId);
      onCommitBoundary?.();
    },
    [doc, identityId, onCommitBoundary],
  );

  /**
   * Add one world sample, splitting into a fresh stroke whenever the cap is reached
   * (`stroke.split`). Committed parts are the first `STROKE_MAX_POINTS` samples; the next part
   * restarts from that part's last point, so the drawn path stays unbroken.
   */
  const append = useCallback(
    (point: Point) => {
      const drawing = drawingRef.current;
      if (!drawing) return;
      drawing.push(point);
      while (drawing.length > STROKE_MAX_POINTS) {
        const part = drawing.slice(0, STROKE_MAX_POINTS);
        commit(part);
        // Keep the shared boundary point, then whatever spilled past the cap.
        const rest = drawing.slice(STROKE_MAX_POINTS);
        const boundary = part[part.length - 1];
        drawing.length = 0;
        if (boundary) drawing.push(boundary, ...rest);
      }
    },
    [commit],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      pointerIdRef.current = event.pointerId;
      const world = screenToWorld(live.current.camera, { x: event.clientX, y: event.clientY });
      drawingRef.current = [world];
      startScreenRef.current = { x: event.clientX, y: event.clientY };
      lastScreenRef.current = { x: event.clientX, y: event.clientY };
      setCursor({ x: event.clientX, y: event.clientY });
      scheduleFrame();
    },
    [scheduleFrame],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const here = { x: event.clientX, y: event.clientY };
      setCursor(here);
      if (drawingRef.current === null) return;
      lastScreenRef.current = here;

      // Record every coalesced sample the browser bundled into this move, then the final point.
      const native = event.nativeEvent as globalThis.PointerEvent;
      const coalesced =
        typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
      const cam = live.current.camera;
      for (const sample of coalesced) {
        append(screenToWorld(cam, { x: sample.clientX, y: sample.clientY }));
      }
      // Drop a trailing coalesced sample that is the current point, then record the current one.
      const lastSample = coalesced[coalesced.length - 1];
      const lastCoalesced = lastSample ? { x: lastSample.clientX, y: lastSample.clientY } : null;
      if (!lastCoalesced || !samePoint(lastCoalesced, here)) {
        append(screenToWorld(cam, here));
      }
      scheduleFrame();
    },
    [append, scheduleFrame],
  );

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLDivElement> | null) => {
      const drawing = drawingRef.current;
      if (drawing === null) return;
      drawingRef.current = null;
      cancelFrame();
      releaseCapture(event?.currentTarget ?? null);
      setPreview(null);

      const up = event
        ? screenPoint(event.clientX, event.clientY)
        : lastScreenRef.current;
      if (!up) return;
      const moved = Math.hypot(up.x - startScreenRef.current.x, up.y - startScreenRef.current.y);
      const firstPoint = drawing[0];
      if (moved < DRAG_THRESHOLD_PX && firstPoint) {
        // A press without a real movement is a dot at the point it landed (`pen.stroke`).
        commit([firstPoint]);
      } else {
        commit(drawing);
      }
    },
    [cancelFrame, commit, releaseCapture],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;
      finish(event);
    },
    [finish],
  );

  // Losing the pointer is not losing the line: keep the points and commit what was drawn (`pen.commit`).
  const handleLostPointerCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (drawingRef.current === null) return;
      finish(event);
    },
    [finish],
  );

  // If the tool is switched away mid-draw (Escape, a toolbar click), keep what was gathered.
  useEffect(
    () => () => {
      if (drawingRef.current && drawingRef.current.length > 0) {
        commit(drawingRef.current);
      }
      drawingRef.current = null;
      cancelFrame();
    },
    [cancelFrame, commit],
  );

  const previewPath = preview && preview.length > 0 ? smoothPath(preview) : '';

  return (
    <div
      className="pen-tool"
      data-testid="pen-tool"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1,
        cursor: 'none',
        // The board owns the gesture; no browser scroll or pinch. Wheel still reaches the
        // viewport by bubbling, so the view pans and zooms while the pen is armed.
        touchAction: 'none',
        pointerEvents: 'all',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerLeave={() => setCursor(null)}
    >
      {/* The preview lives in screen space, so it is drawn at a fixed size to the eye. */}
      <svg
        className="pen-tool__preview"
        data-testid="pen-preview-layer"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
        aria-hidden="true"
      >
        {previewPath ? (
          <path
            data-testid="pen-preview"
            d={previewPath}
            fill="none"
            stroke={ink}
            strokeWidth={tipSize}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      {cursor ? (
        <div
          className="pen-tool__cursor"
          data-testid="pen-cursor"
          style={{
            position: 'absolute',
            left: cursor.x,
            top: cursor.y,
            width: Math.max(4, tipSize),
            height: Math.max(4, tipSize),
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: ink,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}


