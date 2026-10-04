/**
 * Story 11: the Pen tool — press, move, let go, and a sketch is on the board.
 *
 * The tool is a layer that owns every pointer gesture while it is held, the way the
 * Shape tool does: a drag that happens to start on a sticky note draws on top of the
 * note rather than moving it (PRD tool.owns_gesture, TC-19). It is drawn *inside* the
 * board surface rather than beside it for one reason — the surface owns the wheel and
 * pinch listeners, so a wheel that lands on this layer bubbles on to them and pans and
 * zooms the board exactly as story 1 taught it, with nothing here re-implemented
 * (PRD pen.navigation).
 *
 * Three things about the gesture are worth saying plainly:
 *
 * - **The preview is not the stroke.** While the pointer moves, the line on the screen is
 *   a screen-space SVG path rebuilt once per animation frame from the recorded points, and
 *   it is never written to the document. Nobody sees a stroke being drawn; they see it
 *   arrive finished (PRD pen.share). On release the recorded points are simplified to
 *   within one screen pixel of what was drawn, so the finished stroke is the drawn one.
 * - **Points are recorded, not drawn.** Every move — including the coalesced ones a fast
 *   pointer batches into a single event — is appended in board units, so what gets stored
 *   belongs to the board and not to the zoom it happened to be drawn at. A release under
 *   the drag threshold commits a single point, which the model draws as a dot the width of
 *   the pen (PRD pen.dot).
 * - **An interrupted stroke is kept.** `pointercancel` and a lost pointer capture count as
 *   finishing: whatever was drawn becomes a stroke (PRD pen.interrupted). Escape or
 *   choosing another tool is a person changing their mind, and that discards — the layer
 *   unmounts and the points recorded in it go with it.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
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
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
}

/** Left mouse button / primary pointer. */
const PRIMARY_MOUSE_BUTTON = 0;

/** The smallest the round cursor is ever drawn: a 2-unit pen at 20% would be invisible. */
export const PEN_MIN_CURSOR_PX = 5;

export function PenTool({ camera, color, thickness, doc, identityId }: PenToolProps) {
  const undo = useUndoController();
  const layerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  // The line being drawn, as an SVG path in screen pixels. Nothing else reads it and
  // nothing writes it to the document.
  const [preview, setPreview] = useState<string | null>(null);

  // The gesture itself, in refs rather than state: a pointer move is not a render. The
  // points are appended as they arrive, and the picture is refreshed once per frame.
  const points = useRef<Point[]>([]);
  const drawing = useRef(false);
  /** Where the pointer went down, in client pixels, for the click-or-drag decision. */
  const pressedAt = useRef<Point | null>(null);
  /** The colour and weight this stroke is being drawn with, chosen when it started. */
  const chosen = useRef<{ color: PenColor; thickness: PenThickness }>({ color, thickness });
  const frame = useRef<number | null>(null);
  const dirty = useRef(false);

  // The camera and the pen can change between frames, and a frame must draw what they are
  // now, not what they were when the gesture began.
  const live = useRef({ camera, color, thickness, doc, identityId });
  live.current = { camera, color, thickness, doc, identityId };

  /**
   * The board point under a client point. The layer covers the board surface exactly, so
   * subtracting its box is what the surface does to its own events and keeps the two
   * conversions telling the same story.
   */
  const worldOf = (clientX: number, clientY: number): Point => {
    const box = layerRef.current?.getBoundingClientRect();
    return screenToWorld(live.current.camera, {
      x: clientX - (box?.left ?? 0),
      y: clientY - (box?.top ?? 0),
    });
  };

  /** The path the points so far draw on this screen, at this zoom. */
  const pathOf = (at: readonly Point[]): string => {
    const cam = live.current.camera;
    return smoothPath(at.map((point) => worldToScreen(cam, point)));
  };

  /**
   * Finish one part of the stroke: simplify what was recorded, and store it.
   *
   * The tolerance is one screen pixel *divided by the zoom*, so the promise that the
   * stored line is within a pixel of the hand is made in the units the eye was using (PRD
   * pen.smooth) while the stroke itself stays in board units for everybody else. One
   * stroke is one transaction, closed off at both ends so it is one undo step.
   *
   * A stroke the document refuses clears the preview silently (see `onPointerUp`): no
   * message, nothing half-drawn left on the screen.
   */
  const commit = (part: readonly Point[]) => {
    if (part.length === 0) return;
    const zoom = live.current.camera.zoom;
    const tolerance = zoom > 0 ? STROKE_SIMPLIFY_TOLERANCE_PX / zoom : STROKE_SIMPLIFY_TOLERANCE_PX;
    const style = chosen.current;
    undo?.boundary();
    createStroke(
      live.current.doc,
      {
        points: simplify(part, tolerance),
        color: style.color,
        thickness: style.thickness,
      },
      live.current.identityId,
    );
    undo?.boundary();
  };

  /**
   * One frame of the preview, and the only thing that re-renders while drawing.
   *
   * The loop runs only while a stroke is in hand, and redraws only when a pointer event
   * has arrived since the last frame: the line follows the pointer at least once per
   * displayed frame (PRD pen.draw) without paying for a render per millisecond of mouse.
   */
  const drawFrame = () => {
    frame.current = null;
    if (!drawing.current) {
      setPreview(null);
      return;
    }
    if (dirty.current) {
      dirty.current = false;
      setPreview(pathOf(points.current));
    }
    frame.current = requestAnimationFrame(drawFrame);
  };

  const stopLoop = () => {
    if (frame.current === null) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  // A layer torn down mid-gesture — the tool switched, the board unmounted — stops the
  // loop with it, and drops the points: the person changed their mind, which is the one
  // interruption that does not save (PRD pen.cancel).
  useEffect(
    () => () => {
      stopLoop();
      drawing.current = false;
      points.current = [];
    },
    [],
  );

  /** Move the round cursor to the pointer, without a render. */
  const moveCursor = (clientX: number, clientY: number) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    const box = layerRef.current?.getBoundingClientRect();
    cursor.style.transform = `translate(${clientX - (box?.left ?? 0)}px, ${
      clientY - (box?.top ?? 0)
    }px)`;
    cursor.style.visibility = 'visible';
  };

  /** Every board point this event stands for, coalesced moves included. */
  const pointsOf = (event: ReactPointerEvent<HTMLDivElement>): Point[] => {
    const native = event.nativeEvent as PointerEvent & {
      getCoalescedEvents?: () => PointerEvent[];
    };
    let batched: PointerEvent[] = [];
    try {
      // A 250 Hz pointer reports several moves per frame; the ones it batches into this
      // event are part of the line the hand drew, so they are all recorded.
      batched = native.getCoalescedEvents?.() ?? [];
    } catch {
      batched = []; // a synthetic event that throws on it; the event itself is enough
    }
    if (batched.length === 0) return [worldOf(native.clientX, native.clientY)];
    return batched.map((one) => worldOf(one.clientX, one.clientY));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    event.preventDefault();
    // Nothing behind this layer pans, marqueeing, selects or moves an object (PRD
    // tool.owns_gesture) — including a press that lands on a note or a shape.
    event.stopPropagation();
    if (drawing.current) return; // a second pointer while one is drawing: the first line goes on
    pressedAt.current = { x: event.clientX, y: event.clientY };
    // The pen is chosen when the stroke starts, so one stroke has one colour and one
    // weight even if the toolbar is somehow moved between two gestures.
    chosen.current = { color: live.current.color, thickness: live.current.thickness };
    points.current = [worldOf(event.clientX, event.clientY)];
    drawing.current = true;
    dirty.current = true;
    try {
      layerRef.current?.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture can fail for synthetic events; the handlers are on a layer that
      // covers the whole board, so the gesture still reaches them.
    }
    moveCursor(event.clientX, event.clientY);
    if (frame.current === null) frame.current = requestAnimationFrame(drawFrame);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    moveCursor(event.clientX, event.clientY);
    if (!drawing.current) return;
    event.stopPropagation();
    for (const point of pointsOf(event)) {
      points.current.push(point);
      dirty.current = true;
    }
    if (points.current.length >= STROKE_MAX_POINTS) {
      // The limit is a finished stroke and a new one, the second starting at the point the
      // first stopped on, so a scribble that goes on for an hour has no gap in it (PRD
      // pen.long_stroke).
      const part = points.current;
      const join = part[part.length - 1]!;
      commit(part);
      points.current = [join];
    }
  };

  /**
   * The end of a gesture, however it ended: released, cancelled, or a capture that went
   * away.
   *
   * A release that barely moved is a click, and a click is one point — a dot the width of
   * the pen (PRD pen.dot). Anything else commits the points recorded. An interruption
   * commits too: a pointer taken away mid-stroke is a hand that left the surface, not a
   * decision to throw the sketch away (PRD pen.interrupted).
   */
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawing.current) return;
    event.stopPropagation();
    const pressed = pressedAt.current;
    drawing.current = false;
    pressedAt.current = null;
    stopLoop();
    const recorded = points.current;
    points.current = [];
    setPreview(null);
    const moved = pressed
      ? Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y)
      : Number.POSITIVE_INFINITY;
    // Below the board's own drag threshold the jitter of a click is not a line.
    commit(moved < DRAG_THRESHOLD_PX ? recorded.slice(0, 1) : recorded);
  };

  const cursorSize = Math.max(PEN_MIN_CURSOR_PX, PEN_THICKNESS_WORLD[thickness] * camera.zoom);

  return (
    <div
      ref={layerRef}
      className="pen-layer"
      data-testid="pen-tool-layer"
      data-tool="pen"
      data-pen-color={color}
      data-pen-thickness={thickness}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onDoubleClick={(event) => {
        // Two clicks with the pen are two dots, never story 2's double-click-a-note.
        event.stopPropagation();
      }}
    >
      <svg className="pen-layer__svg" data-testid="pen-preview" aria-hidden="true" focusable="false">
        {preview ? (
          <path
            data-testid="pen-preview-path"
            d={preview}
            fill="none"
            stroke={PEN_COLORS[chosen.current.color]}
            strokeWidth={Math.max(0.5, PEN_THICKNESS_WORLD[chosen.current.thickness] * camera.zoom)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>
      {/* The pointer, replaced by a ring the size the stroke will be: what you are about to
          draw is the cursor (PRD pen.cursor). Hidden until the pointer has been seen. */}
      <div
        ref={cursorRef}
        className="pen-layer__cursor"
        data-testid="pen-cursor"
        aria-hidden="true"
        style={
          {
            width: `${cursorSize}px`,
            height: `${cursorSize}px`,
            borderColor: PEN_COLORS[color],
          } as CSSProperties
        }
      />
    </div>
  );
}
