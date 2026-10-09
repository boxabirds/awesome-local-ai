import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { createStroke, penColorValue } from '../../shared/objects/stroke';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';

/**
 * The Pen tool's surface (`pen.tool`): the layer that sits over the board while the Pen is up,
 * shows the line being drawn, and puts one stroke — or several, for a stroke too long to be
 * one — on the board when the pointer stops.
 *
 * Three things about it are worth stating plainly, because they are the three the tests push on:
 *
 * - The line being drawn is **local**. It lives in this component and is drawn in screen pixels;
 *   nothing is written to the document until the pointer is released, so nobody else sees a
 *   half-drawn stroke (PRD: "Others do not see a stroke while it is being drawn"). One
 *   `createStroke` transaction per finished stroke is what they see (design: pen.share).
 * - It **is the pointer capture**. Nothing below it gets a press, so a drag that starts on top of
 *   a sticky note draws a line instead of moving the note, and never pans the board (design:
 *   pen.navigation). Scrolling is untouched: the wheel still reaches the viewport.
 * - It **keeps the tool up**. A finished stroke is not a reason to go back to Select, because a
 *   sketch is more than one line (PRD: pen.stay_active). Nothing calls `toolCreated`, and the
 *   new stroke is not even selected.
 *
 * The points are collected in board units so a stroke drawn while the board moves under the
 * pointer (wheel-scrolling mid-gesture, say) stays where it was drawn, and the preview is
 * redrawn once per animation frame however many pointer events the browser delivered — which is
 * what makes a fast drag look smooth rather than like a chain of straight lines.
 */
export interface PenToolProps {
  /** The camera, for turning the pointer into board units and the line back into pixels. */
  camera: Camera;
  /** The colour the next stroke is drawn in (`pen.options`). */
  color: PenColor;
  /** The thickness the next stroke is drawn at. */
  thickness: PenThickness;
  doc: Y.Doc;
  /** The device drawing, stored as the stroke's `createdBy` (story 6). */
  identityId: string;
}

/** A pointer event that knows about the frames it coalesced into this one. */
type CoalescedPointerEvent = PointerEvent & {
  getCoalescedEvents?(): PointerEvent[];
};

export function PenTool({ camera, color, thickness, doc, identityId }: PenToolProps): JSX.Element {
  const undo = useUndoController();
  // Everything a pointer event needs is read through refs: a drag can be long, and the board
  // can be zoomed, panned, or re-rendered underneath it many times before the pointer lets go.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const docRef = useRef(doc);
  docRef.current = doc;
  const optionsRef = useRef({ color, thickness, identityId });
  optionsRef.current = { color, thickness, identityId };

  /** The points of the line being drawn, in board units. Never in the document. */
  const pointsRef = useRef<Point[]>([]);
  /** Where the press started, in screen pixels: how far from it decides line or dot. */
  const startRef = useRef<Point | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  /** The frame that will repaint the preview, or null when one is not pending. */
  const frameRef = useRef<number | null>(null);
  // The preview path in screen pixels, and the round cursor, are React state: they are the only
  // part of a drawing gesture this component has to remember between its own renders.
  const [preview, setPreview] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  // A tool taken away in the middle of a drag drops the drag: Escape between two strokes must
  // not leave a half-finished line on the board (TC-13), and the same goes for the board being
  // unmounted underneath the pointer.
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      pointsRef.current = [];
      startRef.current = null;
      pointerIdRef.current = null;
    },
    [],
  );

  /** Repaint the preview at the next frame — at most once per frame, however fast the pointer is. */
  const repaint = (): void => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const cam = cameraRef.current;
      const points = pointsRef.current;
      setPreview(
        points.length === 0
          ? null
          : smoothPath(points.map((point) => worldToScreen(cam, point))),
      );
    });
  };

  /**
   * Write one stroke. The tolerance is `STROKE_SIMPLIFY_TOLERANCE_PX` in *screen* pixels at the
   * zoom the line was drawn at, so the finished stroke is within one pixel of the hand at every
   * zoom (design: pen.smooth); a lone point is already as simple as it gets.
   *
   * Each call is bracketed by undo boundaries, so one stroke — and one part of a stroke that had
   * to be split — is one undo step (story 8). A stroke the model refuses (no points, a
   * coordinate that is not a number) is discarded in silence.
   */
  const commit = (points: readonly Point[]): void => {
    if (points.length === 0) return;
    const cam = cameraRef.current;
    const zoom = cam.zoom > 0 ? cam.zoom : 1;
    const simplified =
      points.length === 1 ? points.slice() : simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    const options = optionsRef.current;
    undo?.boundary();
    createStroke(
      docRef.current,
      { points: simplified, color: options.color, thickness: options.thickness },
      options.identityId,
    );
    undo?.boundary();
  };

  /** Every point this event carries, in board units: the event itself, then its coalesced ones. */
  const appendPoints = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const element = event.currentTarget;
    const cam = cameraRef.current;
    const native = event.nativeEvent as CoalescedPointerEvent;
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : null;
    const batch = coalesced && coalesced.length > 0 ? coalesced : [native];
    for (const one of batch) {
      const screen = screenPointOf(element, one.clientX, one.clientY);
      pointsRef.current.push(screenToWorld(cam, screen));
      startRef.current ??= screen;
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // The press belongs to the pen, and nothing under it hears about it — which is the whole of
    // why a Pen drag neither pans the board nor moves the object it started on.
    event.stopPropagation();
    if (pointerIdRef.current !== null) return;
    pointerIdRef.current = event.pointerId;
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
    const at = screenPointOf(element, event.clientX, event.clientY);
    startRef.current = at;
    pointsRef.current = [screenToWorld(cameraRef.current, at)];
    setCursor(at);
    repaint();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    event.stopPropagation();
    const element = event.currentTarget;
    appendPoints(event);
    setCursor(screenPointOf(element, event.clientX, event.clientY));
    // The very long stroke (`pen.long_stroke`): the limit is reached during the capture, that
    // part is written, and the line carries on from the point it stopped on.
    if (pointsRef.current.length >= STROKE_MAX_POINTS) {
      const parts = splitPoints(pointsRef.current, STROKE_MAX_POINTS);
      const first = parts[0] ?? [];
      commit(first);
      const last = first[first.length - 1];
      // What came in with this event after the limit, and the shared join point.
      const rest: Point[] = [];
      for (const part of parts.slice(1)) rest.push(...part.slice(1));
      pointsRef.current = last ? [last, ...rest] : rest;
    }
    repaint();
  };

  /**
   * The press is over, one way or another: released, cancelled by the system, or the capture was
   * taken away. All three mean the same thing to a stroke — finish it with what was drawn
   * (design: pen.interrupted) — so all three come through here.
   */
  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (pointerIdRef.current !== event.pointerId) return;
    pointerIdRef.current = null;
    const points = pointsRef.current;
    pointsRef.current = [];
    startRef.current = null;
    setPreview(null);
    setCursor(null);
    if (points.length === 0) return;
    // A press that never got past the drag threshold is a click, and a click is a dot: one
    // point, drawn as a round dot the diameter of the thickness (`pen.dot`). How far the press
    // got is measured by how much ground the line covered, not by where it ended — a circle is
    // drawn by coming back to where it started, and that is the most ink there is, not none.
    const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
    const dot = points.length === 1 || spread(points) <= DRAG_THRESHOLD_PX / zoom;
    commit(dot ? points.slice(0, 1) : points);
  };

  const onLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A release always commits first, so this is the interruption case: the browser took the
    // pointer back without asking.
    if (pointerIdRef.current !== event.pointerId) return;
    finish(event);
  };

  const cam = cameraRef.current;
  // The line being drawn is drawn where it is: the same points, through the same camera, so the
  // preview and the finished stroke are the same line. Its width is the thickness in board units
  // scaled by the zoom, because this layer is in screen pixels and the world layer is not.
  const width = Math.max(PEN_THICKNESS_WORLD[thickness] * cam.zoom, 1);

  return (
    <div
      className="vidi6-pen-tool-surface"
      data-testid="pen-tool-surface"
      data-pen-color={color}
      data-pen-thickness={thickness}
      style={{ position: 'absolute', inset: 0, cursor: 'crosshair', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={stop}
    >
      <svg
        className="vidi6-pen-preview-svg"
        data-testid="pen-preview-svg"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
      >
        {preview ? (
          <path
            data-testid="pen-preview"
            d={preview}
            fill="none"
            stroke={penColorValue(color)}
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      {/* The round cursor: the thickness, at this zoom, so the pen shows what it writes. */}
      {cursor ? (
        <div
          className="vidi6-pen-cursor"
          data-testid="pen-cursor"
          data-cursor-size={Math.round(width)}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: `${cursor.x - width / 2}px`,
            top: `${cursor.y - width / 2}px`,
            width: `${width}px`,
            height: `${width}px`,
            borderRadius: '50%',
            background: penColorValue(color),
            opacity: 0.5,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
}

function stop(event: { stopPropagation(): void }): void {
  event.stopPropagation();
}

/** How much ground a line covered in board units: the longer side of the box it fitted in. */
function spread(points: readonly Point[]): number {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(maxX - minX, maxY - minY);
}

/** The pointer, in pixels inside the viewport, which is what the camera works in. */
function screenPointOf(element: HTMLElement, clientX: number, clientY: number): Point {
  const rect = element.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
