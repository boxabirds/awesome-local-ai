import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type { Doc } from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import { worldToScreen, type Camera } from '../canvas/camera';
import { useBoard } from '../board/BoardContext';
import { isBoardUi, isClick, isPrimaryButton, onDragEnds, worldPoint } from './boardPointer';

export interface PenToolProps {
  /** The camera: board units in, screen units out, both ways. */
  camera: Camera;
  /** What to draw with. The pen's own state, shown by {@link PenToolbar} and read at the moment of commit. */
  color: PenColor;
  thickness: PenThickness;
  /** The document the stroke is written to. */
  doc: Doc;
  /** Who drew it: this client's id, stamped into every stroke. */
  identityId: string;
}

/** A pointer position as the browser reports it, which is all the capture ever reads off an event. */
interface ClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

/**
 * The stroke being drawn: the path so far in board units, and the two things needed to finish it.
 *
 * `buffer` shrinks to the tail of the path every time a part of it is committed mid-drag, which is the
 * only moment during a gesture that anything is written at all.
 */
interface Capture {
  pointerId: number;
  /** Where the press went down, on the screen. A press that came back here drew a dot, not a line. */
  down: Point;
  /** The path so far, board units, in the order it arrived. */
  buffer: Point[];
  /** The last point kept, board units: what the next point is compared against. */
  last: Point;
}

/**
 * Two points this far apart on the screen are the same point.
 *
 * A 240 Hz stylus reports a position every four milliseconds, which at the speed a hand moves is a
 * fraction of a pixel; keeping them all would put a thousand identical numbers on the wire for a line
 * that is four inches long. Half a pixel is well under anything a person can aim at, and it is applied
 * *before* the path is simplified rather than after, so the simplifier is not asked to do the arithmetic
 * of a point that was never news.
 */
const MIN_POINT_DISTANCE_PX = 0.5;

/** The captured path, projected where the person is looking, as the line they are being shown. */
function previewOf(points: readonly Point[], camera: Camera): string {
  // Screen units, deliberately: the preview is drawn in a fixed overlay rather than on the board, so a
  // stroke in progress is the same thickness on every screen and does not re-project while it is being
  // drawn. It is also why nothing has to be re-rendered for the others: they are not looking at this.
  return smoothPath(points.map((point) => worldToScreen(camera, point)));
}

/**
 * Every position this move covers, in the order they happened - including the ones the browser
 * folded into the one event it delivered.
 *
 * A mouse at 125 Hz and a stylus at 240 Hz both arrive at the handler at the frame rate, because the
 * browser holds positions back and hands them over in a batch. `getCoalescedEvents()` is the batch; the
 * event itself is its last and usually only member. Reading only the event would draw every line at
 * about sixty points a second, which on a fast stroke is a polyline where the person drew a curve.
 */
function coalesced(event: PointerEvent): readonly ClientPoint[] {
  if (typeof event.getCoalescedEvents !== 'function') {
    return [event];
  }
  const batch = event.getCoalescedEvents();
  return batch.length > 0 ? batch : [event];
}

/**
 * The Pen tool: press, move, let go, and there is a drawing on the board (story 11).
 *
 * Four things about this component are worth saying, because three of them are things it does *not* do.
 *
 * **It writes once, at the end.** The line that follows the pointer is local state - a path string in a
 * fixed overlay, rebuilt at most once per animation frame - and it is never written to the document
 * while the drag is going. That is what keeps other people's screens steady (they see a finished stroke
 * appear, never a half-drawn one flicker), and it is what makes a stroke of five thousand points one
 * update on the wire rather than five thousand. The one exception is a stroke so long it has to be
 * committed in parts, below.
 *
 * **It takes the pointer before anything else does.** Like the Shape tool, it listens in the *capture*
 * phase on the window, so a drag that starts on top of a sticky note draws on the board instead of
 * moving the note, and the board's own pan, marquee and double-click-to-make-a-note are swallowed with
 * it. {@link BoardViewport} additionally refuses to start a pan while the pen is up, which is the same
 * rule written twice on purpose: one of the two is a bug in the other.
 *
 * **It stays up.** A shape, an arrow and a line of text each go back to Select when they are made,
 * because a person who has placed one thing has usually come back to pointing at things. A stroke is the
 * opposite: nobody draws one. The pen is put down by Escape or by another tool, and until then every
 * drag is another stroke in the same colour.
 *
 * **It does not clear the selection.** A press with the pen is a press with a pen, and the outline of
 * the note it happened to start on is somebody else's business; the shape and connector tools leave the
 * selection alone for the same reason.
 *
 * A stroke that reaches {@link STROKE_MAX_POINTS} points is committed as it is drawn: the finished part
 * becomes a stroke, and the new one opens on the last point of the part before it, so the two join with
 * no seam. That is the one case where the pen writes mid-gesture, and it is a case that only happens on
 * a line nobody could draw without lifting their hand anyway.
 */
export function PenTool({ camera, color, thickness, doc, identityId }: PenToolProps): JSX.Element {
  const services = useBoard();
  /** The line being drawn, in screen units, or null when the pen is not down. */
  const [preview, setPreview] = useState<string | null>(null);
  /** Where the pointer is, screen units, or null while it is over a toolbar. */
  const [cursor, setCursor] = useState<Point | null>(null);

  const captureRef = useRef<Capture | null>(null);
  /** The animation frame a preview rebuild is waiting for; at most one is ever outstanding. */
  const frameRef = useRef<number | null>(null);

  // Everything the listeners read has to be current without reinstalling them - reinstalling them in the
  // middle of a drag is how a drag gets lost. The camera moves under a drag when the wheel is used
  // mid-stroke; the colour changes when a swatch is pressed with the other hand.
  const cameraRef = useRef(camera);
  const propsRef = useRef({ color, thickness, doc, identityId });
  const servicesRef = useRef(services);
  useEffect(() => {
    const changed = cameraRef.current !== camera;
    cameraRef.current = camera;
    propsRef.current = { color, thickness, doc, identityId };
    servicesRef.current = services;
    if (changed && captureRef.current !== null) {
      // The board moved underneath a stroke that is still being drawn. The path is stored in board
      // units, so the drawing itself is unaffected; only the line being shown has to be re-projected,
      // and it is re-projected here rather than on the next move, because a person who stopped moving
      // to look is looking at the preview.
      setPreview(previewOf(captureRef.current.buffer, camera));
    }
  });

  useEffect(() => {
    let stopListening: (() => void) | null = null;

    const show = (): void => {
      const capture = captureRef.current;
      setPreview(capture === null ? null : previewOf(capture.buffer, cameraRef.current));
    };

    /** Rebuild the preview at most once per frame, however many moves arrived in between. */
    const schedule = (): void => {
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        show();
      });
    };

    /**
     * Turn a path into a stroke on the board.
     *
     * The simplification is done here rather than during the drag for the reason that matters: the
     * person is looking at the *un*smoothed line while they draw it, and a preview that lost points as
     * it went would be a preview that redraws the line a little differently on every move. What the
     * guarantee costs is one pass at the end, and what it buys is that the stored path is within
     * {@link STROKE_SIMPLIFY_TOLERANCE_PX} of a point of the path they were shown - at the zoom they
     * were shown it at, which is the only zoom the promise was ever made about.
     */
    const commit = (points: readonly Point[]): void => {
      const board = servicesRef.current;
      if (board !== null && !board.canEdit) {
        // A board that cannot be written to keeps its pen in its pocket, and says nothing: the button
        // that arms the tool is disabled on such a board, so the only way to be here is a board that
        // stopped being writable while the pointer was down.
        return;
      }
      const zoom = cameraRef.current.zoom;
      const tolerance = Number.isFinite(zoom) && zoom > 0 ? STROKE_SIMPLIFY_TOLERANCE_PX / zoom : 0;
      const { doc: strokeDoc, color: colour, thickness: width, identityId: by } = propsRef.current;
      for (const part of splitPoints(points, STROKE_MAX_POINTS)) {
        const kept = simplify(part, tolerance);
        const id = createStroke(strokeDoc, { points: kept, color: colour, thickness: width }, by);
        // Each finished stroke is its own undo step: Ctrl+Z takes away the last line, not the whole
        // sketch. `boundary` is the history's word for "the next change starts a new step".
        board?.undo?.boundary();
        if (id === null) {
          // A drawing the model refused. Silently, and with the pen exactly where it was: the person
          // still has their pen, their colour and their next drag.
          continue;
        }
      }
    };

    /** Add one board position to the path, committing the front of it if it has filled up. */
    const append = (world: Point): void => {
      const capture = captureRef.current;
      if (capture === null) {
        return;
      }
      capture.buffer.push(world);
      capture.last = world;
      if (capture.buffer.length < STROKE_MAX_POINTS) {
        return;
      }
      // The path is long enough to be worth committing. The last part is the one still being drawn -
      // `splitPoints` opens it on the point that closed the part before, which is why the seam between
      // two committed parts is invisible - and it is committed below as soon as the pointer is lifted.
      const parts = splitPoints(capture.buffer, STROKE_MAX_POINTS);
      const tail = parts.pop();
      for (const part of parts) {
        commit(part);
      }
      capture.buffer = tail === undefined || tail.length === 0 ? [world] : tail;
    };

    const move = (event: PointerEvent): void => {
      const capture = captureRef.current;
      if (capture === null || event.pointerId !== capture.pointerId) {
        return;
      }
      const zoom = cameraRef.current.zoom;
      for (const point of coalesced(event)) {
        const world = worldPoint(cameraRef.current, point);
        if (
          Number.isFinite(world.x) &&
          Number.isFinite(world.y) &&
          Math.hypot((world.x - capture.last.x) * zoom, (world.y - capture.last.y) * zoom) >=
            MIN_POINT_DISTANCE_PX
        ) {
          append(world);
        }
      }
      schedule();
    };

    /**
     * The drag is over - lifted, or interrupted.
     *
     * `pointercancel` lands here too, and it commits rather than throws the path away: an interruption
     * comes at the end of a line somebody drew, and the honest reading of a browser taking the pointer
     * back is "finish what you were shown", not "you meant nothing by it". The same is true of a press
     * that never travelled, which is a dot rather than a mistake, and which is why there is no branch
     * here for a cancelled press that stayed still.
     */
    const finish = (event: PointerEvent): void => {
      const capture = captureRef.current;
      if (capture === null || event.pointerId !== capture.pointerId) {
        return;
      }
      captureRef.current = null;
      stopListening?.();
      stopListening = null;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setPreview(null);
      if (capture.buffer.length === 0) {
        return;
      }
      // A press that came back to where it started is a dot: one point, which the model gives a box of
      // its own thickness. What is committed is the point the pen went *down* on rather than the four
      // the pointer reported while it shook inside three pixels, because a dot drawn at the place it
      // was aimed at is the thing that was asked for.
      const still = isClick(capture.down, { x: event.clientX, y: event.clientY });
      const first = capture.buffer[0];
      commit(still && first !== undefined ? [first] : capture.buffer);
    };

    const down = (event: PointerEvent): void => {
      if (isBoardUi(event.target) || !isPrimaryButton(event) || captureRef.current !== null) {
        return;
      }
      const world = worldPoint(cameraRef.current, event);
      if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      captureRef.current = {
        pointerId: event.pointerId,
        down: { x: event.clientX, y: event.clientY },
        buffer: [world],
        last: world,
      };
      // Move and release are listened for on the window: a stroke drawn towards the edge of the window
      // is a stroke that leaves the edge of the window, and it must stay one stroke. Nothing calls
      // setPointerCapture for the pen - the viewport declines the press - so there is no capture to
      // lose, and `pointercancel` is the whole of the interruption the browser can hand us.
      stopListening = onDragEnds(move, finish);
      // The first point is shown at once rather than on the next frame, so that the dot of a press that
      // is about to become a dot exists the moment the pen is put down.
      show();
    };

    const swallowDoubleClick = (event: MouseEvent): void => {
      // Two presses of the pen are two dots, not a sticky note underneath them.
      if (isBoardUi(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };

    /** The round cursor, which follows the pointer wherever the pen is up - drawing or not. */
    const hover = (event: PointerEvent): void => {
      if (isBoardUi(event.target)) {
        // Over a toolbar the person is aiming at a button, and the button has its own cursor.
        setCursor(null);
        return;
      }
      setCursor({ x: event.clientX, y: event.clientY });
    };

    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', hover);
    window.addEventListener('dblclick', swallowDoubleClick, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', hover);
      window.removeEventListener('dblclick', swallowDoubleClick, true);
      // A stroke that was still being drawn is dropped, and dropped silently. Escape is pressed with
      // the intention of not making that mark - which is the same answer the Shape tool gives, and
      // what makes "Escape leaves no stroke behind" need no code of its own: the component goes away,
      // and the path it was holding goes with it.
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      stopListening?.();
      stopListening = null;
      captureRef.current = null;
      setPreview(null);
      setCursor(null);
    };
  }, []);

  // The pen, as the person sees it: the thickness they chose, at the zoom they are at, in pixels.
  const widthPx = PEN_THICKNESS_WORLD[thickness] * camera.zoom;
  const hex = PEN_COLORS[color];

  return (
    <>
      {preview === null ? (
        // No stroke in progress, no overlay: an element stretched across the board that answers no
        // events is still an element in the way of whatever the next person tries to click.
        <></>
      ) : (
        <svg className="tool-preview pen-preview" data-testid="pen-preview" aria-hidden="true">
          <path
            className="pen-preview__path"
            data-testid="pen-preview-path"
            d={preview}
            fill="none"
            stroke={hex}
            strokeWidth={widthPx}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor === null ? (
        <></>
      ) : (
        <div
          className="pen-cursor"
          data-testid="pen-cursor"
          aria-hidden="true"
          style={{
            left: `${cursor.x - widthPx / 2}px`,
            top: `${cursor.y - widthPx / 2}px`,
            width: `${widthPx}px`,
            height: `${widthPx}px`,
            background: hex,
          }}
        />
      )}
    </>
  );
}
