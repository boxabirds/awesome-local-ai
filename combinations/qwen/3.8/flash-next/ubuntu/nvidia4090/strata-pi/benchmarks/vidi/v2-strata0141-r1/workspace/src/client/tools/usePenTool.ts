import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { worldToScreen, type Camera, type Point } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import type { BoardSurface } from '../canvas/BoardViewport';
import { useBoardUndo } from '../board/useUndo';
import { isBoardChrome, isTypingTarget, surfacePointOf, worldPointOf } from './toolPointer';

/**
 * The Pen tool's gesture (anchors `pen.draw`, `pen.dot`, `pen.interrupted`,
 * `pen.long_stroke`, `pen.share`).
 *
 * ```mermaid
 * stateDiagram-v2
 *     [*] --> Idle
 *     Idle --> Drawing : pointerdown with the pen in hand
 *     Drawing --> Drawing : pointermove appends points, one preview redraw per frame
 *     Drawing --> Drawing : STROKE_MAX_POINTS reached - commit the part, continue from its last point
 *     Drawing --> Idle : pointerup - simplify, then createStroke
 *     Drawing --> Idle : pointercancel / lostpointercapture - commit the points so far
 *     Drawing --> Idle : the pen is dropped (Escape, another tool): nothing is created
 * ```
 *
 * Like the Shape and Connector tools, the listeners are on `window` in the
 * **capture** phase and `stopPropagation` runs on the press and on every move
 * while a stroke is live. That single fact is what makes `pen.navigation` true
 * without touching the viewport's wheel handlers: a pointer drag belongs to the pen
 * and never reaches the board's pan, marquee or object gesture - not when it starts
 * on empty board space and not when it starts on a sticky note (`pen.over_objects`,
 * TC-19) - while wheel and pinch keep panning and zooming exactly as story 1.
 *
 * **Two representations of one stroke.** The points the model is given are world
 * points, so a stroke is the same object at 50% and at 200%. The preview is a
 * screen-space path, because it is what the eye is following, and a stroke finished
 * at the zoom it was drawn at must look like what was drawn.
 *
 * **The preview is local** (`pen.share`): it lives in this hook's React state and
 * is never written to the document, so nobody else can see a stroke being drawn.
 * What they see is the one `createStroke` transaction on release, delivered by
 * story 3.
 *
 * **One redraw per animation frame** (`pen.smooth` live, TC-17): points are
 * appended on every event, including coalesced ones, but the path is rebuilt in a
 * `requestAnimationFrame` callback, so a 120 Hz pointer never costs 120 path
 * rebuilds and the line still moves at least once per displayed frame.
 */
export interface PenToolArgs {
  doc: Y.Doc;
  /** The pen is the tool in hand. */
  armed: boolean;
  color: PenColor;
  thickness: PenThickness;
  /** The board surface: where it sits on screen, and the camera it is drawn with. */
  surface: BoardSurface | null;
  createdBy: string;
}

export interface PenPreview {
  /** The path being drawn, in **screen** units. */
  readonly d: string;
  /** Its on-screen width, so the preview is as wide as the stroke will be. */
  readonly strokeWidth: number;
}

export interface PenToolGesture {
  /** The stroke in progress, or null while the pen is not drawing. */
  readonly preview: PenPreview | null;
  /** Where the pen tip is on screen, for the round cursor (`pen.cursor`). */
  readonly cursor: Point | null;
  /** Screen size of the dot this pen would make: thickness x zoom. */
  readonly cursorSize: number;
}

interface LiveStroke {
  pointerId: number;
  /** Every point recorded so far, in world units, oldest first. */
  points: Point[];
  /** Where the press landed, in world units: the dot a click makes. */
  anchor: Point;
  /** The same press in screen units, which is what the drag threshold measures. */
  startClient: Point;
  /** Past `DRAG_THRESHOLD_PX` yet? A press either moved or it did not (`pen.dot`). */
  moved: boolean;
  /**
   * The zoom the stroke is being drawn at. The smoothing tolerance is one *screen*
   * pixel (`STROKE_SIMPLIFY_TOLERANCE_PX`), so the world-unit tolerance is this
   * divided by the zoom held while drawing (`pen.smooth`, TC-02).
   */
  zoom: number;
}

/** A pointer event's own points, plus whatever the browser coalesced into it. */
function coalescedEvents(event: PointerEvent): PointerEvent[] {
  const coalesced =
    typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  return coalesced.length > 0 ? coalesced : [event];
}

export function usePenTool(args: PenToolArgs): PenToolGesture {
  const undo = useBoardUndo();

  /** What is drawn this frame: the preview path and the pen tip. */
  const [visual, setVisual] = useState<{ preview: PenPreview | null; cursor: Point | null }>({
    preview: null,
    cursor: null,
  });

  const strokeRef = useRef<LiveStroke | null>(null);
  const cursorRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);

  // The camera, the options and the document are read through a ref, so a stroke
  // in progress is never interrupted - and never drawn with a stale colour - when
  // the board re-renders underneath it.
  const inputs = useRef(args);
  inputs.current = args;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const { armed } = args;

  useEffect(() => {
    if (!armed) {
      // Dropping the pen drops the stroke in progress: nothing is created, and the
      // preview goes away (`pen.stay_active`, TC-13).
      strokeRef.current = null;
      cursorRef.current = null;
      setVisual({ preview: null, cursor: null });
      return undefined;
    }

    const cameraOf = (): Camera | null => {
      const camera = inputs.current.surface?.camera ?? null;
      if (!camera || !Number.isFinite(camera.zoom) || camera.zoom <= 0) {
        return null;
      }
      return camera;
    };

    const cancelFrame = (): void => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
    };

    /**
     * Rebuild what is drawn, once per animation frame (`pen.draw`, TC-17).
     *
     * The preview path is the smoothed polyline of everything recorded so far, in
     * screen units: the same `smoothPath` the finished object is drawn with, so the
     * line a person is looking at is the line they are about to get.
     */
    const draw = (): void => {
      frameRef.current = null;
      const camera = cameraOf();
      const stroke = strokeRef.current;
      const cursor = cursorRef.current;
      if (!camera) {
        setVisual({ preview: null, cursor: null });
        return;
      }
      const preview: PenPreview | null = stroke
        ? {
            // The same `smoothPath` the finished object is drawn with, in the
            // coordinates the eye is looking in.
            d: smoothPath(stroke.points.map((point) => worldToScreen(camera, point))),
            strokeWidth: PEN_THICKNESS_WORLD[inputs.current.thickness] * camera.zoom,
          }
        : null;
      setVisual({ preview, cursor });
    };

    const scheduleDraw = (): void => {
      if (frameRef.current !== null || typeof requestAnimationFrame !== 'function') {
        return;
      }
      frameRef.current = requestAnimationFrame(() => draw());
    };

    /**
     * Finish the stroke, or one part of it (`pen.draw`, `pen.smooth`,
     * `pen.long_stroke`).
     *
     * Simplified at the zoom it was drawn at, then committed as one stroke per part
     * of `splitPoints`. A part is one `createStroke`, one transaction, one undo step
     * (`pen.undo`), and `stopCapturing` after it so the next part - or the next
     * thing this person does - is its own step too.
     */
    const commit = (points: readonly Point[], zoom: number): void => {
      if (points.length === 0) {
        return;
      }
      const current = inputs.current;
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
      for (const part of splitPoints(simplify(points, tolerance))) {
        createStroke(current.doc, { points: part, color: current.color, thickness: current.thickness }, current.createdBy);
        // A stroke that was refused (`null`) wrote nothing; the step is closed
        // either way, so the next action is never joined to this one.
        undoRef.current?.boundary();
      }
    };

    const finish = (keep: boolean): void => {
      const stroke = strokeRef.current;
      strokeRef.current = null;
      if (!stroke) {
        return;
      }
      if (keep) {
        // A press that never left the click is a dot: exactly the point the pen
        // was put down on (`pen.dot`, TC-10). An interrupted drag keeps the points
        // it has (`pen.interrupted`, TC-11).
        commit(stroke.moved ? stroke.points : [stroke.anchor], stroke.zoom);
      }
      cancelFrame();
      setVisual((previous) => ({ preview: null, cursor: previous.cursor }));
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || strokeRef.current !== null) {
        return;
      }
      if (isBoardChrome(event.target) || isTypingTarget(event.target)) {
        return; // the pen's own toolbar, and anything being typed into, is not a stroke
      }
      const camera = cameraOf();
      const anchor = worldPointOf(event, inputs.current.surface);
      if (!camera || !anchor) {
        return; // no camera, no world point: the pen draws nothing it cannot place
      }
      event.stopPropagation();
      // A stroke is a step of its own, whatever was moved or typed before it.
      undoRef.current?.boundary();
      strokeRef.current = {
        pointerId: event.pointerId,
        points: [anchor],
        anchor,
        startClient: { x: event.clientX, y: event.clientY },
        moved: false,
        zoom: camera.zoom,
      };
      cursorRef.current = surfacePointOf(event, inputs.current.surface);
      // Held long enough to draw with: keep the pointer even when it leaves the
      // board, so a stroke that runs off the edge is not cut short.
      try {
        (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
      } catch {
        // jsdom (and browsers that reject capture) still track the stroke here.
      }
      scheduleDraw();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!strokeRef.current || event.pointerId !== strokeRef.current.pointerId) {
        cursorRef.current = isBoardChrome(event.target) ? null : surfacePointOf(event, inputs.current.surface);
        scheduleDraw();
        return;
      }
      const stroke = strokeRef.current;
      event.stopPropagation();
      const camera = cameraOf();
      if (!camera) {
        return;
      }
      for (const coalesced of coalescedEvents(event)) {
        const point = worldPointOf(coalesced, inputs.current.surface);
        if (!point) {
          continue;
        }
        stroke.points.push(point);
      }
      if (
        !stroke.moved &&
        Math.hypot(event.clientX - stroke.startClient.x, event.clientY - stroke.startClient.y) >=
          DRAG_THRESHOLD_PX
      ) {
        stroke.moved = true; // a drag, not a click (`pen.dot`)
      }
      cursorRef.current = surfacePointOf(event, inputs.current.surface);

      // `pen.long_stroke`: the part that is full is committed and the stroke
      // continues from its last point, so the two meet with no gap (TC-12).
      if (stroke.points.length >= STROKE_MAX_POINTS) {
        const part = stroke.points.slice(0, STROKE_MAX_POINTS);
        const last = part[part.length - 1]!;
        commit(part, stroke.zoom);
        stroke.points = [last];
      }
      scheduleDraw();
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (!strokeRef.current || event.pointerId !== strokeRef.current.pointerId) {
        return;
      }
      event.stopPropagation();
      const stroke = strokeRef.current;
      const last = worldPointOf(event, inputs.current.surface);
      if (last && stroke.moved) {
        stroke.points.push(last); // the point the pen was lifted at is part of the line
      }
      finish(true);
    };

    const onPointerCancel = (event: PointerEvent): void => {
      if (strokeRef.current?.pointerId !== event.pointerId) {
        return;
      }
      finish(true); // `pen.interrupted`: what was drawn is kept
    };

    const onLostPointerCapture = (event: PointerEvent): void => {
      if (strokeRef.current?.pointerId !== event.pointerId) {
        return;
      }
      finish(true); // the capture is gone; the stroke so far is still what was drawn
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    window.addEventListener('lostpointercapture', onLostPointerCapture, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      window.removeEventListener('lostpointercapture', onLostPointerCapture, true);
      cancelFrame();
      strokeRef.current = null;
      cursorRef.current = null;
    };
  }, [armed]);

  const camera = args.surface?.camera ?? null;
  const cursorSize = camera
    ? PEN_THICKNESS_WORLD[args.thickness] * (Number.isFinite(camera.zoom) ? camera.zoom : 1)
    : PEN_THICKNESS_WORLD[args.thickness];

  return { preview: visual.preview, cursor: visual.cursor, cursorSize };
}
