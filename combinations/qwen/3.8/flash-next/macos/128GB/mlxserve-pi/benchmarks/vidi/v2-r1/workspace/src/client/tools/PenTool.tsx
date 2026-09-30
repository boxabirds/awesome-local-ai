// Drawing freehand (`pen.draw`, `pen.dot`, `pen.interrupted`, `pen.long_stroke`).
//
// The Pen tool is an invisible sheet over the board while `pen` is the active tool, and it
// owns four things:
//
//   - **The recorded path.** Every pointer move, in board units, appended as it arrives —
//     including the samples the browser coalesced into one event, which is the difference
//     between a line that looks drawn and a line that looks plotted (`pen.draw`). The path
//     lives in a ref, not in state: five hundred points a second is not five hundred
//     renders, and the frame that is displayed is redrawn once per animation frame.
//
//   - **The preview, which is this screen's.** The path is painted as a local SVG overlay
//     and is never written to the document while the pen is down, so nobody else watches
//     your hand (`pen.share`). It is drawn from the world's own coordinates, through
//     `worldToScreen`, which is what keeps the line you are drawing anchored to the board
//     when the wheel moves the board underneath your hand.
//
//   - **When a part is finished.** At `STROKE_MAX_POINTS` recorded points the part that is
//     there is committed and the drawing carries on from the same last point, so a sketch
//     the size of a wall is two strokes that join with no gap rather than one object nobody
//     can redraw in a frame (`pen.long_stroke`).
//
//   - **What a finished stroke is.** The points are simplified at `STROKE_SIMPLIFY_TOLERANCE_PX`
//     divided by the zoom *the drawing happened at* — one screen pixel of faithfulness, at
//     any zoom (`pen.smooth`) — and handed to `createStroke` as one object, in one local
//     transaction, in the colour and thickness the toolbar is showing.
//
// Two things this tool deliberately does not do, and both are the story: it does not put the
// tool away when it has drawn something (`pen.stay_active` — a pen that had to be picked up
// again after every line is not a pen), and it does not commit anything when it is taken away
// mid-drag (Escape means *nothing*, so the preview is thrown away and no stroke exists).
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (pen.tool)
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type * as Y from 'yjs';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { PenColor, PenThickness } from '../../shared/config';
import {
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { createStroke, strokeColorCss } from '../../shared/objects/stroke';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  doc: Y.Doc;
  camera: Camera;
  /** What the next stroke is drawn with (`pen.options`). */
  color: PenColor;
  thickness: PenThickness;
  /** The `createdBy` the stroke carries. */
  identityId: string;
  /**
   * This tab's undo history: one finished stroke is one step. The design's contract lists
   * five props and this is the sixth — opening and closing the undo step is the tool's job
   * and nothing else's, because one stroke is one action however many points it holds.
   */
  undo?: UndoController;
}

/** A drag in progress: the path so far, and where the pointer last was. */
interface Draft {
  /** The recorded path, in board units. Mutated in place; see the note in the render. */
  points: Point[];
  /** The last pointer position, in screen pixels, for the round cursor. */
  cursor: Point;
  /** Where the pen went down: how far a drag has to travel to be a line, `pen.dot`. */
  origin: Point;
  /** False while the pointer has never been further than `DRAG_THRESHOLD_PX` away. */
  moved: boolean;
}

export function PenTool({
  doc,
  camera,
  color,
  thickness,
  identityId,
  undo,
}: PenToolProps): ReactNode {
  // The draft lives in a ref; `frame` is what makes it visible. Nothing re-renders this
  // component but the frame tick and the camera, so a hundred events a second cost one
  // render per displayed frame — and the path is recomputed from the world during render,
  // which is why moving the board with the wheel while the pen is down keeps the line
  // stuck to the board instead of to the screen.
  const draft = useRef<Draft | null>(null);
  const frame = useRef<number | null>(null);
  const [, setTick] = useState(0);

  // The camera the handlers were created with is the camera the drag is measured with:
  // `screenToWorld` divides by the zoom, so a drag of 200 pixels at 200% is 100 board
  // units, which is the same place on the board the pointer is over.
  const zoom = camera.zoom > 0 ? camera.zoom : 1;

  /** Redraw the preview at most once per animation frame. */
  const schedule = (): void => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setTick((tick) => tick + 1);
    });
  };

  const stopFrame = (): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };

  /**
   * Commit one part of the drawing: smooth it at this zoom's tolerance and put exactly one
   * object on the board, as one undo step (`pen.smooth`, `pen.long_stroke`).
   */
  const commit = (points: readonly Point[]): void => {
    if (points.length === 0) return;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const smoothed = simplify(points, tolerance);
    undo?.boundary();
    createStroke(doc, { points: smoothed, color, thickness }, identityId);
    undo?.boundary();
  };

  /**
   * The pointer came up, was cancelled, or the capture went away: the drawing is finished
   * (`pen.draw`, `pen.interrupted`).
   *
   * An interruption commits what was drawn rather than throwing it away, because a stroke
   * that vanishes because the browser decided to eat the pointer is a lost drawing. The
   * draft is cleared *before* anything is written, so the release, the capture release and
   * a cancel that follow one another commit one stroke and not three.
   */
  const finish = (): void => {
    const active = draft.current;
    if (active === null) return;
    draft.current = null;
    stopFrame();
    setTick((tick) => tick + 1);
    // A press and a release with nothing between them is a dot: one point, drawn as a
    // round mark the diameter of the thickness it was drawn with (`pen.dot`).
    commit(active.moved ? active.points : active.points.slice(0, 1));
  };

  /**
   * The limit was reached: commit what is recorded and carry on from its last point
   * (`pen.long_stroke`). The join point belongs to both parts, which is what makes two
   * strokes read as one line.
   */
  const splitIfNeeded = (active: Draft): void => {
    if (active.points.length < STROKE_MAX_POINTS) return;
    const parts = splitPoints(active.points, STROKE_MAX_POINTS);
    const over = active.points.length > STROKE_MAX_POINTS;
    const done = over ? parts.slice(0, -1) : parts;
    const rest = over ? (parts[parts.length - 1] as Point[]) : [active.points[active.points.length - 1] as Point];
    for (const part of done) commit(part);
    active.points = rest;
  };

  /** Append every point this event carries, coalesced samples and all. */
  const record = (active: Draft, event: ReactPointerEvent<HTMLDivElement>): void => {
    const native = event.nativeEvent as PointerEvent & {
      getCoalescedEvents?: () => PointerEvent[];
    };
    // A coalescing browser hands over the fine-grained samples the frame swallowed; one
    // that does not gets the event's own position instead. Never both: the coalesced list
    // already ends where this event ended.
    let samples: PointerEvent[] = [];
    if (typeof native.getCoalescedEvents === 'function') {
      try {
        samples = native.getCoalescedEvents();
      } catch {
        samples = [];
      }
    }
    if (samples.length === 0) samples = [native];
    for (const sample of samples) {
      const at = screenToWorld(camera, { x: sample.clientX, y: sample.clientY });
      active.points.push(at);
      active.cursor = { x: sample.clientX, y: sample.clientY };
      const dx = sample.clientX - active.origin.x;
      const dy = sample.clientY - active.origin.y;
      if (!active.moved && dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        active.moved = true;
      }
    }
    splitIfNeeded(active);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || draft.current !== null) return;
    // The board under the sheet does not pan, and a press here is never the start of a
    // marquee or a click on the object underneath (`pen.navigation`).
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const at = screenToWorld(camera, { x: event.clientX, y: event.clientY });
    draft.current = {
      points: [at],
      cursor: { x: event.clientX, y: event.clientY },
      origin: { x: event.clientX, y: event.clientY },
      moved: false,
    };
    schedule();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = draft.current;
    if (active === null) return;
    event.stopPropagation();
    record(active, event);
    schedule();
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (draft.current === null) return;
    event.stopPropagation();
    finish();
  };

  // Taken away, not put down: an interruption is a finished stroke (`pen.interrupted`), so
  // the same release handler answers for the cancel the browser may send.
  const onRelease = onPointerUp;

  // Escape, or another tool, takes the pen away in the middle of a drag. That is not a
  // stroke: the draft goes out with the tool and nothing is written (`pen.stay_active`,
  // TC-13). A layout effect, because this has to be true before the sheet is out of the
  // document — a browser whose pointer capture is taken from under it says so afterwards,
  // and a late word from a disposed tool must not draw something nobody asked for.
  useLayoutEffect(
    () => () => {
      draft.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  // The line as this screen paints it: the recorded path, in world units, put through the
  // same smoothing the finished stroke gets and drawn at the camera currently on screen.
  //
  // Reading `draft.current` during render is safe and is the whole point: the ref only
  // changes from pointer handlers, and every handler asks for a frame. The alternative —
  // the path in state — means a render per pointer event, which is the thing that makes a
  // freehand tool stutter.
  const active = draft.current;
  const preview = active === null ? null : smoothPath(active.points.map((point) => worldToScreen(camera, point)));

  return (
    <div
      data-testid="pen-tool"
      data-color={color}
      data-thickness={thickness}
      aria-label="Drawing with the pen"
      style={sheetStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      // An interruption finishes the stroke rather than discarding it (`pen.interrupted`).
      onPointerCancel={onRelease}
      onLostPointerCapture={finish}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {preview !== null && preview !== '' ? (
        <svg data-testid="pen-tool-preview" style={previewStyle} aria-hidden="true">
          <path
            data-testid="pen-tool-preview-path"
            d={preview}
            fill="none"
            // The preview is drawn exactly as the finished stroke will be: same colour, same
            // width in board units, round ends. A preview that lies about the result is
            // worse than no preview.
            stroke={strokeColorCss(color)}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {active === null ? null : (
        <div
          data-testid="pen-tool-cursor"
          aria-hidden="true"
          style={{
            ...cursorStyle,
            left: active.cursor.x,
            top: active.cursor.y,
            width: PEN_THICKNESS_WORLD[thickness] * zoom,
            height: PEN_THICKNESS_WORLD[thickness] * zoom,
            backgroundColor: strokeColorCss(color),
          }}
        />
      )}
    </div>
  );
}

const sheetStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  // The tool is between you and the board: the board cannot be panned through it and a
  // drag that starts here is never a move. The wheel is deliberately left to reach the
  // board, so scrolling with the pen up still scrolls the board (`pen.navigation`).
  cursor: 'crosshair',
  touchAction: 'none',
  userSelect: 'none',
};

const previewStyle: CSSProperties = {
  // Screen space, over the whole viewport, and utterly transparent to the pointer: the
  // stroke in it is not in the document, and nothing is behind it to click.
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  overflow: 'visible',
  pointerEvents: 'none',
};

const cursorStyle: CSSProperties = {
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
  borderRadius: '50%',
  pointerEvents: 'none',
  boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.7)',
};
