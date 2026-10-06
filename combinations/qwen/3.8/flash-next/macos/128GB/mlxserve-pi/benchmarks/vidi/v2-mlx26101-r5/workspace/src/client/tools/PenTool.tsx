/**
 * The Pen tool: the pointer that draws a line rather than picking one up (story 11).
 *
 * How it holds the pointer is the same hold the Shape and Connector tools built and for the same reason:
 * the gesture has to be taken off *everything underneath it*. A press that begins on a note, a shape or an
 * arrow with this tool lit is the beginning of a stroke — the design's "a Pen drag never pans the board or
 * moves objects under the pointer", and the case that matters is the one a bubble-phase handler cannot
 * reach: drawing a circle *round* a cluster of notes means the pointer starts on one of them. So the
 * listeners are on the document, in the capture phase, and the event stops where it stands.
 *
 * What it hands back is a preview and a stroke, and the two are deliberately not the same thing. The
 * preview is a screen-space SVG path that lives in this component's state and is never written to the
 * document, which is the whole of why nobody else sees a stroke while it is being drawn: there is nothing
 * in the document for the sync layer to carry. The stroke is one `createStroke` transaction, written when
 * the pen lifts, and that transaction is what everybody else receives.
 *
 * The preview is redrawn once per animation frame and not once per pointer event, which is the difference
 * between a line that follows the pointer and a component that renders two hundred times a second from a
 * trackpad. The *points*, though, are recorded on every event — including the coalesced ones a browser
 * holds back and hands over in a burst — because a preview may be allowed to miss a frame and a drawing may
 * not miss the turn of a corner that happened inside it.
 *
 * Four things it does not do, each on purpose:
 * — it does not hand the pointer back to Select. A person sketching draws several strokes in a row, and
 *   being put back to the arrow pointer after every one of them means pressing P again between every line.
 *   So this tool never calls `onCreated`; the tool is left alone, and Escape or another letter is what ends
 *   it.
 * — it does not throw a stroke away when the system takes the pointer back. A pinch from the trackpad, a
 *   browser gesture, a phone call: `pointercancel` finishes the stroke with the points drawn so far, because
 *   the line someone drew is worth more than the interruption that ended it.
 * — it does not write one enormous object. At `STROKE_MAX_POINTS` recorded points the part is committed and
 *   drawing goes on from the same last point, so a two-minute doodle is two strokes that join rather than a
 *   document held hostage by one `Y.Map` of ten thousand numbers.
 * — it does not survive Escape. The tool is unmounted, this component goes with it, and the half-drawn
 *   stroke goes with the component and writes nothing — the same rule every other tool has, for the same
 *   reason: the key that ends a tool ends its unfinished drags.
 */

import { useEffect, useRef, useState } from 'react';
import type { Doc } from 'yjs';

import { DRAG_THRESHOLD_PX, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import { worldToScreen } from '../canvas/camera';
import type { Camera, Point } from '../canvas/camera';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import {
  createStroke,
  penThicknessWorld,
  strokeColorOf,
  type PenColor,
  type PenThickness,
} from '../../shared/objects/stroke';
import type { UndoControls } from '../board/useUndo';

export interface PenToolProps {
  /** The document the finished stroke is written into. */
  doc: Doc;
  /** The camera the pointer is being read through: the preview's size, and the smoothing tolerance. */
  camera: Camera;
  /** Which of the six colours the next stroke is drawn in. */
  color: PenColor;
  /** Which of the three thicknesses the next stroke is drawn with. */
  thickness: PenThickness;
  /** Who made it, which is this person's identity and not the stroke's business. */
  identityId: string;
  /**
   * Turns a point on this screen into a point on the board.
   *
   * Given rather than derived: the board owns the element the pointer is measured against, and a tool that
   * measured it again would be a second answer to where the board starts.
   */
  toWorld(point: Point): Point;
  /** This person's undo history: one stroke — or one part of a long one — is one step, whatever came before it. */
  undo?: UndoControls;
}

/** The stroke this pointer is drawing, in the world units the model wants. */
interface Drawing {
  pointerId: number;
  /** The point the pen touched down on, which is the dot a press-and-release leaves behind. */
  start: Point;
  /** The same point on the screen, which is what the distance a press moved is measured from. */
  from: { x: number; y: number };
  /** How far the pen has travelled from where it touched down, in screen pixels, at its furthest. */
  travel: number;
}

/** The preview: the drawn line as a path on the screen, and where the pen tip is. */
interface Preview {
  /** Path data in screen pixels, smoothed through the recorded points. */
  d: string;
  /** The pen tip, in screen pixels. */
  tip: Point;
}

/** Buttons, toolbars and open text fields keep their own clicks, whatever tool is lit. */
const isControl = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  target.closest('button, textarea, input, select, [role="toolbar"]') !== null;

/**
 * The smoothing tolerance the stroke drawn through this camera is entitled to.
 *
 * `STROKE_SIMPLIFY_TOLERANCE_PX` is a number of *screen pixels* — how far the finished line may be from
 * the line that was drawn, as measured on the glass — and the model works in world units, so the two are
 * only the same number at 100 %. Divide by the zoom: at 200 % a pixel is half a world unit, so the stroke
 * is smoothed to half a unit, which is what "within one screen pixel" has always meant when the person drew
 * it at that size. A camera that cannot say its zoom keeps every point, which is the only safe reading of a
 * measurement that failed.
 */
const toleranceOf = (camera: Camera): number =>
  Number.isFinite(camera.zoom) && camera.zoom > 0 ? STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom : STROKE_SIMPLIFY_TOLERANCE_PX;

/**
 * The pointer events of one move, oldest first.
 *
 * A browser that is asked for pointer events at 60 Hz while the mouse reports at 500 Hz coalesces the ones
 * it did not get round to showing and hands them over on the next event, through `getCoalescedEvents()`.
 * They are the corners of a drawing — a turn made between two frames is in one of them and nowhere else —
 * so they are recorded, and the current event is recorded as the last of them. Where the method is missing
 * (an older browser, jsdom) the event is the whole of the move.
 */
const eventsOf = (event: PointerEvent): PointerEvent[] => {
  const coalesced = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
  const list = coalesced.length > 0 ? Array.from(coalesced) : [];
  // Some browsers include the current event in its own coalesced list and some do not; the last one is
  // always the event being handled, so it is put there rather than argued with.
  const last = list[list.length - 1];
  if (last === undefined || last.timeStamp !== event.timeStamp) list.push(event);
  return list;
};

export function PenTool(props: PenToolProps): React.JSX.Element {
  const { camera } = props;
  /** The line being drawn, in world units, oldest point first. A ref: two hundred points a second is not state. */
  const pointsRef = useRef<Point[]>([]);
  const drawingRef = useRef<Drawing | null>(null);
  /** The frame the preview is waiting for, so that ten moves in one frame draw one path. */
  const frameRef = useRef<number | null>(null);
  /** The pen tip, positioned by the pointer directly rather than by a render. */
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  // Everything the listeners need arrives through refs: they are installed once, and the colour changes,
  // the camera moves and the commit happens in the middle of the gestures they are routing.
  const propsRef = useRef(props);
  propsRef.current = props;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  /** The pen tip, in screen pixels, for the dot that follows it. Written to the DOM and not to state: a cursor that re-rendered the board on every move would be a board that could not draw. */
  const moveCursor = (event: PointerEvent): void => {
    const el = cursorRef.current;
    if (el === null) return;
    // Out of sight over the toolbar and the pen's own swatches, where the pointer is choosing a pen rather
    // than drawing with one.
    if (isControl(event.target)) {
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = 'visible';
    const size = penThicknessWorld(propsRef.current.thickness) * cameraRef.current.zoom;
    // Centred on the pointer, which is what a cursor the size of the pen means: the ink goes where the tip
    // is, and the tip is the middle of the dot.
    el.style.transform = `translate(${event.clientX - size / 2}px, ${event.clientY - size / 2}px)`;
  };

  useEffect(() => {
    /** Draws the whole recorded line, once, for this frame. */
    const paint = (): void => {
      frameRef.current = null;
      const points = pointsRef.current;
      if (points.length === 0) {
        setPreview(null);
        return;
      }
      const view = cameraRef.current;
      // Screen space, from the world points, every frame: a stroke belongs to the board rather than to the
      // glass, so if the camera is moved while the pen is down — a pinch, a stray scroll — the line being
      // drawn goes with the board instead of being left behind on the screen.
      const screen = points.map((point) => worldToScreen(view, point));
      const tip = screen[screen.length - 1] as Point;
      setPreview({ d: smoothPath(screen), tip });
    };

    const schedule = (): void => {
      if (frameRef.current !== null) return;
      if (typeof requestAnimationFrame !== 'function') {
        paint();
        return;
      }
      frameRef.current = requestAnimationFrame(paint);
    };

    const unpaint = (): void => {
      if (frameRef.current === null) return;
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };

    /**
     * One stroke, or one part of a long one, into the document.
     *
     * One step of the history, and a refusal clears the preview and says nothing else: the line a person
     * drew is gone from the screen and there is no second place it could have been mentioned. Nothing here
     * retries it or changes the tool — a stroke the model would not take was made of numbers that cannot be
     * drawn, and the pen is still the pen for the next one.
     */
    const commit = (points: readonly Point[]): boolean => {
      const owner = propsRef.current;
      const history = owner.undo;
      const kept = simplify(points, toleranceOf(cameraRef.current));
      // A boundary on both sides, like every other write site: the stroke is a step of its own and is not
      // folded into the drag that ended a moment ago, and whatever comes next is not folded into this one.
      history?.boundary();
      const id = createStroke(
        owner.doc,
        { points: kept, color: owner.color, thickness: owner.thickness },
        owner.identityId,
      );
      history?.boundary();
      if (typeof id !== 'string') {
        unpaint();
        setPreview(null);
        return false;
      }
      return true;
    };

    /**
     * The line has grown past what one object should hold: put the part away and carry on from its end.
     *
     * The join is the reason this is a loop rather than a single test. `splitPoints` says what the parts are
     * and which point they share; what is left to decide is *when* to cut, and the answer is as soon as the
     * limit is reached — because the points after the limit are already on their way into the document by
     * then, and a tool that waited for the release would have a list of twenty thousand points to cut into
     * pieces at the least convenient moment.
     */
    const drain = (): number => {
      let pending = pointsRef.current;
      let parts = 0;
      while (pending.length >= STROKE_MAX_POINTS) {
        const part = pending.slice(0, STROKE_MAX_POINTS);
        commit(part);
        parts += 1;
        // The new part begins on the point the old one ended on, so the two lines meet and there is no gap
        // between the strokes to see.
        pending = pending.slice(STROKE_MAX_POINTS - 1);
      }
      pointsRef.current = pending;
      return parts;
    };

    const onPointerDown = (event: PointerEvent) => {
      // Only the left button: the right one opens a menu and the middle one is a scroll.
      if (event.button !== 0 || isControl(event.target)) return;
      // Taken off the board and off whatever object is underneath it, in the same breath: see the note at
      // the top of this file. `stopPropagation` and not `stopImmediatePropagation`, which is the line every
      // other tool draws for the same purpose — the event still has to reach the handlers standing on the
      // document itself, one of which is an open text editor's, which commits what was typed on a press
      // outside the object it was typed into.
      event.stopPropagation();
      event.preventDefault();
      const start = propsRef.current.toWorld({ x: event.clientX, y: event.clientY });
      drawingRef.current = {
        pointerId: event.pointerId,
        start,
        from: { x: event.clientX, y: event.clientY },
        travel: 0,
      };
      pointsRef.current = [start];
      // Capture so that the moves keep coming when the pointer leaves the window — which a stroke drawn
      // across the edge of the screen does, and which would otherwise end the line early and lose the rest
      // of it. Where capture is not implemented (jsdom, some embedded browsers) the moves come by the usual
      // route and nothing about the drawing changes.
      try {
        document.documentElement.setPointerCapture?.(event.pointerId);
      } catch {
        // Not a drawing problem: the pen still draws from the events that do arrive.
      }
      moveCursor(event);
      schedule();
    };

    const onPointerMove = (event: PointerEvent) => {
      const drawing = drawingRef.current;
      if (drawing === null || event.pointerId !== drawing.pointerId) {
        // The pen tip follows the pointer whenever the pen is the tool, and not only while it is on the
        // paper: a cursor that woke up only when the line started is a cursor that is not a cursor.
        moveCursor(event);
        return;
      }
      event.stopPropagation();
      const here = { x: event.clientX, y: event.clientY };
      // The furthest the pen has been from where it touched down, not where it is now: a person who makes a
      // little mark and brings the pen back to the start has still made a mark, and the reading of a press
      // that wandered is the wandering and not the last position.
      drawing.travel = Math.max(drawing.travel, Math.hypot(here.x - drawing.from.x, here.y - drawing.from.y));
      for (const point of eventsOf(event)) {
        pointsRef.current.push(propsRef.current.toWorld({ x: point.clientX, y: point.clientY }));
      }
      moveCursor(event);
      drain();
      schedule();
    };

    /**
     * The pen lifted, or the system took the pointer back. Either way the line is finished, and either way
     * the line is kept.
     *
     * The two are the same handler because the design says so: `pointercancel` and `lostpointercapture` are
     * "something else wanted the pointer", and the answer to that is to write down what was drawn rather
     * than to throw it away — a person who loses a two-second sketch to a stray three-finger gesture has
     * lost something they made, for a reason they cannot see.
     */
    const finish = (event: PointerEvent) => {
      const drawing = drawingRef.current;
      if (drawing === null || event.pointerId !== drawing.pointerId) return;
      drawingRef.current = null;
      const points = pointsRef.current;
      unpaint();
      setPreview(null);
      if (points.length === 0) {
        pointsRef.current = [];
        return;
      }

      if (drawing.travel < DRAG_THRESHOLD_PX) {
        pointsRef.current = [];
        // A press and a release with nothing between them is a dot, and the dot is the pen: one point, the
        // round cap doing the rest, a circle as wide as the ink. The *first* point is committed and not the
        // last, because the tremor between down and up is not a place a person was aiming at.
        commit([points[0] as Point]);
        return;
      }

      // Where the pen came off the paper belongs to the line. A browser is not obliged to send a move for
      // the last millimetre before the release — the release *is* the last position it knows — so the point
      // the release carries is recorded here rather than left out, and a stroke drawn to the edge of the
      // screen ends at the edge of the screen instead of one recorded move short of it.
      const lift = propsRef.current.toWorld({ x: event.clientX, y: event.clientY });
      const last = points[points.length - 1] as Point;
      if (Number.isFinite(lift.x) && Number.isFinite(lift.y) && (lift.x !== last.x || lift.y !== last.y)) {
        points.push(lift);
      }

      // The lift can be the point that takes the line over the limit, so the limit is checked again here.
      // What is left afterwards is committed too, with one exception: a tail of one point is the very point
      // the part above it was closed on, and writing it as a stroke of its own would draw a dot on top of
      // the join — visible as a bead at the end of a thick line, and worth the condition.
      pointsRef.current = points;
      const parts = drain();
      const tail = pointsRef.current;
      pointsRef.current = [];
      if (tail.length > 1 || (tail.length === 1 && parts === 0)) commit(tail);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
    // The other half of the capture: a pointer the browser took back sends no `pointerup` at all, and this
    // is the only news that it went. It arrives on the element that held the capture, which bubbles, which
    // is why it is listened for here.
    document.addEventListener('lostpointercapture', finish, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
      document.removeEventListener('lostpointercapture', finish, true);
      // An unfinished stroke leaves with the tool and writes nothing on the way out: Escape, a letter, or
      // the board going read-only takes the pen away, and the line that was half drawn goes with it.
      drawingRef.current = null;
      pointsRef.current = [];
      unpaint();
      setPreview(null);
    };
    // Installed once for as long as the tool is on screen. The tool can end in the middle of the gesture it
    // owns — a `pointercancel` that arrives while the board is being taken away — and the tail of that
    // gesture still belongs to the tool that began it.
  }, []);

  // The pen's own width on the screen, which is the width it draws at and the size of the dot that follows
  // the pointer: the world width of the ink times how big a world unit is on this glass.
  const size = penThicknessWorld(props.thickness) * camera.zoom;

  return (
    <div
      aria-hidden="true"
      className="pen-layer"
      data-testid="pen-layer"
      style={
        {
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 8,
        } as React.CSSProperties
      }
    >
      {preview === null ? null : (
        <svg
          className="pen-preview"
          data-testid="pen-preview"
          height="100%"
          style={{ display: 'block', overflow: 'visible' } as React.CSSProperties}
          width="100%"
        >
          <path
            d={preview.d}
            data-testid="pen-preview-path"
            data-x={preview.tip.x}
            data-y={preview.tip.y}
            fill="none"
            // The same three attributes the finished stroke is drawn with, which is the whole of why the
            // line does not change its appearance the moment the pen lifts: round caps and joins, no fill,
            // and a width that is the pen's width on this screen.
            strokeLinecap="round"
            strokeLinejoin="round"
            stroke={strokeColorOf(props.color)}
            strokeWidth={size}
          />
        </svg>
      )}
      <div
        className="pen-cursor"
        data-testid="pen-cursor"
        ref={cursorRef}
        style={
          {
            position: 'fixed',
            left: 0,
            top: 0,
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: '50%',
            background: strokeColorOf(props.color),
            // Out of the way until the pointer comes over the board, and out of the pointer's way always:
            // a cursor that could be clicked would be a cursor that stops the next stroke.
            visibility: 'hidden',
            pointerEvents: 'none',
          } as React.CSSProperties
        }
      />
    </div>
  );
}
