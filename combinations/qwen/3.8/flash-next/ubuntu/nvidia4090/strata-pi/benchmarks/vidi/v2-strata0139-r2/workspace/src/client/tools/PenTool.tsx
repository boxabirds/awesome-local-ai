import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Doc } from "yjs";
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from "../../shared/config";
import type { Point } from "../../shared/geometry";
import { simplify, smoothPath } from "../../shared/geometry/simplify";
import { createStroke } from "../../shared/objects/stroke";
import { screenToWorld, worldToScreen, type Camera } from "../canvas/camera";
import { isBoardControl, isPrimaryPointer, useCaptureGestures } from "./useCaptureGestures";

/**
 * `tools.PenTool` — the freehand pen (story 11).
 *
 * While the Pen tool is armed this component owns the board's pointer: its
 * listeners are attached to `document` in the capture phase (`pen.press`), so a
 * press can only ever start a stroke — not a pan, not a marquee, not a select, not
 * a drag of the sticky note it happens to land on. That is also what lets a drag
 * *start on* a note and still draw.
 *
 * What it does with the press:
 *
 * - every pointer point of the drag is recorded in board units, coalesced pointer
 *   events included, so a fast drag is not thinned to one point per frame
 *   (`pen.smooth`);
 * - while the drag is going, the same points are drawn in a screen-space SVG
 *   overlay, refreshed once per animation frame (`pen.preview`);
 * - on release the points are simplified with a **screen**-pixel tolerance
 *   (`STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, so the finished line is within one
 *   screen pixel of what was drawn at whatever zoom it was drawn at), then
 *   committed as one stroke in one `createStroke` call — one `LOCAL_ORIGIN`
 *   transaction, one undo step (`pen.stroke`, `stroke.undo`);
 * - a press that never travelled `DRAG_THRESHOLD_PX` is a dot: the press point
 *   alone (`pen.dot`);
 * - a drag that reaches `STROKE_MAX_POINTS` commits what it has and carries on from
 *   the same point, so a very long scribble is two strokes with no gap in it
 *   (`pen.long_stroke`);
 * - `pointercancel` and a lost pointer capture keep the points recorded so far;
 *   leaving the tool (Escape, V) draws nothing.
 *
 * The tool stays armed after a stroke — drawing is a mode you stay in — and nothing
 * is selected, so the stroke just drawn does not turn into handles in the way.
 */
export interface PenToolProps {
  /** Camera used to convert pointer positions, and to scale the preview. */
  camera: Camera;
  /** The colour the committed stroke carries. */
  color: PenColor;
  /** The thickness the committed stroke carries. */
  thickness: PenThickness;
  doc: Doc;
  /** Recorded as the stroke's `createdBy` when this tab has an identity to give. */
  identityId?: string;
  canEdit?: boolean;
  /**
   * Opened before and after each commit, so one stroke is one undo step and a split
   * stroke is one step per part (`stroke.undo`).
   */
  onGestureBoundary?(): void;
}

/** One press: the drag's recorded points plus what is needed to finish it. */
interface Drawing {
  pointerId: number;
  /** Recorded points, board units. Replaced by a new part at the point limit. */
  points: Point[];
  /** How many points the current part holds. */
  recorded: number;
  /** Where the press landed, in screen pixels. */
  start: Point;
  /** The furthest the pointer has been from the press, in screen pixels. */
  travelled: number;
  /** How many parts this drag has already committed at the point limit. */
  committed: number;
}

export function PenTool({
  camera,
  color,
  thickness,
  doc,
  identityId,
  canEdit = true,
  onGestureBoundary,
}: PenToolProps): ReactElement | null {
  // The handlers live in one effect for the tool's whole lifetime, so they read the
  // props the board is rendered with *now*, not the ones the press started with.
  const latest = useRef({ camera, color, thickness, doc, identityId, canEdit, onGestureBoundary });
  latest.current = { camera, color, thickness, doc, identityId, canEdit, onGestureBoundary };

  const drawingRef = useRef<Drawing | null>(null);
  /** Where the pointer is, in screen pixels: where the cursor preview goes. */
  const cursorRef = useRef<Point | null>(null);
  /** The one preview refresh that is scheduled: one re-render per animation frame. */
  const frameRef = useRef<number | null>(null);
  const [, setFrame] = useState(0);

  const zoomOf = (): number => {
    const zoom = latest.current.camera.zoom;
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  };

  const schedulePreview = (): void => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setFrame((count) => count + 1);
    });
  };

  const clearFrame = (): void => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  };

  /** The stroke itself: simplified at one screen pixel of tolerance. */
  const commit = (points: readonly Point[]): string | null => {
    if (points.length === 0) return null;
    const simplified = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoomOf());
    const current = latest.current;
    current.onGestureBoundary?.();
    const id = createStroke(
      current.doc,
      { points: simplified, color: current.color, thickness: current.thickness },
      current.identityId,
    );
    current.onGestureBoundary?.();
    return id;
  };

  /** Ends the press: commit what was drawn, or drop it when the tool was left. */
  const finish = (keep: boolean): void => {
    const drawing = drawingRef.current;
    drawingRef.current = null;
    clearFrame();
    if (drawing === null) return;
    if (keep) {
      // A press that never travelled is a dot at the press point (`pen.dot`).
      const points = drawing.travelled < DRAG_THRESHOLD_PX ? drawing.points.slice(0, 1) : drawing.points;
      // A split that landed exactly on the release leaves a part holding only the
      // join point, and that point is already the end of the stroke before it.
      if (points.length > 1 || drawing.committed === 0) commit(points);
    }
    setFrame((count) => count + 1);
  };

  /** Records one pointer point, splitting the stroke at the point limit. */
  const record = (drawing: Drawing, screenPoint: Point): void => {
    const world = screenToWorld(latest.current.camera, screenPoint);
    const last = drawing.points[drawing.points.length - 1];
    // The same board point twice adds nothing to the line.
    if (last !== undefined && last.x === world.x && last.y === world.y) return;
    drawing.points.push(world);
    drawing.recorded += 1;
    const fromPress = Math.hypot(screenPoint.x - drawing.start.x, screenPoint.y - drawing.start.y);
    if (fromPress > drawing.travelled) drawing.travelled = fromPress;

    if (drawing.recorded >= STROKE_MAX_POINTS) {
      // `pen.long_stroke`: commit this part, then carry on from the same point so
      // the next part starts exactly where this one ended.
      const join = drawing.points[drawing.points.length - 1]!;
      commit(drawing.points);
      drawing.committed += 1;
      drawing.points = [join];
      drawing.recorded = 1;
    }
  };

  useCaptureGestures(canEdit, {
    onPointerDown: (event, point) => {
      if (drawingRef.current !== null) return false;
      // A press on a control belongs to the control (the pen's own swatches too).
      if (isBoardControl(event.target)) return false;
      cursorRef.current = point;
      const drawing: Drawing = {
        pointerId: event.pointerId,
        points: [screenToWorld(latest.current.camera, point)],
        recorded: 1,
        start: point,
        travelled: 0,
        committed: 0,
      };
      drawingRef.current = drawing;
      // Pointer capture is what keeps a drag that runs off the edge of the board
      // collecting points, and keeps them coming to this document.
      const root = document.documentElement;
      if (typeof root.setPointerCapture === "function") {
        try {
          root.setPointerCapture(event.pointerId);
        } catch {
          // A browser that will not capture still gets a usable drag.
        }
      }
      schedulePreview();
      return true;
    },
    onPointerMove: (event, point) => {
      const drawing = drawingRef.current;
      if (drawing === null) return;
      cursorRef.current = point;
      const coalesced = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
      if (coalesced.length > 0) {
        for (const single of coalesced) record(drawing, { x: single.clientX, y: single.clientY });
      } else {
        record(drawing, point);
      }
      schedulePreview();
    },
    onPointerUp: (_event, point) => {
      const drawing = drawingRef.current;
      if (drawing === null) return;
      // The release point belongs to the stroke as well: without it a stroke ends
      // one pointer sample short of where the person let go.
      record(drawing, point);
      cursorRef.current = point;
      finish(true);
    },
    onPointerCancel: () => {
      // `pen.cancel`: the points so far are a drawing, not a mistake.
      finish(true);
    },
  });

  // A lost pointer capture is an ending with no pointerup (the browser took the
  // pointer away): the stroke drawn so far is kept.
  useEffect(() => {
    if (!canEdit) return;
    const onLostPointerCapture = (event: Event) => {
      const drawing = drawingRef.current;
      if (drawing === null) return;
      if (event instanceof PointerEvent && event.pointerId !== drawing.pointerId) return;
      finish(true);
    };
    document.addEventListener("lostpointercapture", onLostPointerCapture);
    return () => document.removeEventListener("lostpointercapture", onLostPointerCapture);
  }, [canEdit]);

  // The cursor preview follows the pointer between strokes as well. A move this
  // tool claimed never reaches this listener — it was stopped at `document` — so
  // the drawing branch above moves the cursor itself.
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (drawingRef.current !== null) return;
      if (!isPrimaryPointer(event)) return;
      const next = isBoardControl(event.target) ? null : { x: event.clientX, y: event.clientY };
      if (next === null && cursorRef.current === null) return;
      cursorRef.current = next;
      schedulePreview();
    };
    document.addEventListener("pointermove", onPointerMove);
    return () => document.removeEventListener("pointermove", onPointerMove);
  }, []);

  // Leaving the tool drops the press without drawing: Escape and V mean "no stroke".
  useEffect(
    () => () => {
      drawingRef.current = null;
      clearFrame();
    },
    [],
  );

  if (!canEdit) return null;

  const zoom = zoomOf();
  const drawing = drawingRef.current;
  const hex = PEN_COLORS[color] ?? PEN_COLORS.black;
  const thicknessScreen = Math.max(1, PEN_THICKNESS_WORLD[thickness] * zoom);
  const previewPath =
    drawing !== null && drawing.points.length > 0
      ? smoothPath(drawing.points.map((point) => worldToScreen(camera, point)))
      : "";
  const cursor = cursorRef.current;

  return (
    <svg
      className="pen-overlay"
      data-testid="pen-overlay"
      aria-hidden="true"
      width="100%"
      height="100%"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {previewPath !== "" ? (
        <path
          data-testid="pen-preview"
          d={previewPath}
          fill="none"
          stroke={hex}
          strokeWidth={thicknessScreen}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {cursor !== null ? (
        <circle
          data-testid="pen-cursor"
          cx={cursor.x}
          cy={cursor.y}
          r={thicknessScreen / 2}
          fill="none"
          stroke={hex}
          strokeWidth={1}
        />
      ) : null}
    </svg>
  );
}
