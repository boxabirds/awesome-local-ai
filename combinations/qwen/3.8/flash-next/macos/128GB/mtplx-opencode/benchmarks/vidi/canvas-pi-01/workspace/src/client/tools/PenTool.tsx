/**
 * Story 11 · task 15 — the Pen tool overlay (design "Pen tool", PRD `pen.draw`).
 *
 * While the Pen tool is active this layer sits *above* the world layer and owns
 * every pointer gesture on the board, so a sketch can start on top of an existing
 * object without ever picking that object up. It records the pointer as drawn —
 * screen positions, converted to world with the live camera — and on release runs
 * exactly one `createStroke` inside one undo step, then stays a Pen so the next
 * sketch can start straight away (PRD `tools.return_to_select` deliberately does
 * not cover the pen). Escape returns to Select, which is also how a finished
 * sketch becomes reachable for select / move / resize: the overlay that makes
 * free drawing possible is the same thing that covers the board's own pointers.
 *
 * Four details keep a hand-drawn sketch cheap and true:
 *  - the coalesced events of a pointer move are all recorded
 *    (`getCoalescedEvents()`), so a fast stroke on a high-rate pointer keeps the
 *    shape it had rather than the ~60 Hz sample of it;
 *  - points closer than half a screen pixel to the previous one are dropped, so a
 *    still hand does not stack hundreds of identical coordinates;
 *  - the preview is republished **once per animation frame** from a `d` string
 *    built out of the recorded points, and it lives only in this component — it is
 *    never written to the document, so nobody else sees a sketch being drawn
 *    (PRD `pen.share`);
 *  - a gesture that reaches `STROKE_MAX_POINTS` commits what it has and starts a
 *    new stroke from the last point, so one long drag can never grow an unbounded
 *    object (PRD `pen.long_stroke`).
 *
 * The ring that follows the pointer is an ink-size guide (thickness × zoom), not
 * a replacement for the OS cursor: the crosshair stays, because a board whose
 * pointer disappears is worse to use than a board whose cursor is a ring.
 */
import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import {
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { screenToWorld, type Camera, type Point, type Size } from '../canvas/camera';
import type { PenColor, PenThickness } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  /** The live camera: every recorded point is converted with it. */
  camera: Camera;
  /** The size of the board area, so the preview SVG can span it. */
  size: Size;
  /** The board document the finished sketch is written to. */
  doc: Y.Doc;
  /** This client's identity, recorded as `createdBy`. */
  by: string;
  /** The ink the next sketch will use. */
  color: PenColor;
  /** The width the next sketch will use. */
  thickness: PenThickness;
  /** The personal undo history: one stroke is one step. */
  undo?: UndoController;
  /** Called with each new id (once per committed stroke). */
  onCreated(id: string): void;
}

/** One in-progress sketch. */
interface Gesture {
  /** Screen positions, for the preview. */
  screen: Point[];
  /** The same positions in world space, for the model. */
  world: Point[];
}

/** What the frame publish puts on screen. */
interface Preview {
  /** The preview path's `d`, in screen coordinates. */
  d: string;
  /** The ink width in screen pixels. */
  width: number;
  /** Where the ink-size ring is centred. */
  cursor: Point;
}

/** How far apart two recorded points must be (screen px) to be worth keeping. */
const MIN_POINT_DISTANCE_PX = 0.5;

export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, doc, by, color, thickness, onCreated } = props;
  const [preview, setPreview] = useState<Preview | null>(null);
  // The gesture lives in a ref, not in state: the pointer handlers are re-created
  // every render, and a commit must see the points exactly as the last move
  // recorded them, not a copy captured by an older render.
  const gestureRef = useRef<Gesture | null>(null);
  const pointerRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);
  const zoom = camera.zoom > 0 ? camera.zoom : 1;

  // No pending frame may outlive the tool: a frame that fires after the Pen tool
  // is switched away would paint over a board that no longer has a preview layer.
  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(frameRef.current);
      }
      frameRef.current = null;
    },
    [],
  );

  const inkWidthPx = Math.max(1, (PEN_THICKNESS_WORLD[thickness] ?? 4) * zoom);

  /** Publish what has been recorded, at most once per animation frame. */
  const schedulePreview = useCallback(() => {
    const publish = () => {
      frameRef.current = null;
      const gesture = gestureRef.current;
      const cursor = pointerRef.current;
      if (cursor === null) {
        setPreview(null);
        return;
      }
      // With no gesture the preview is only the round cursor: the Pen tool's
      // pointer is meant to show the size of the ink while it is merely hovering,
      // not just mid-stroke (PRD pen.options, golden path step 1).
      setPreview({
        d: gesture === null ? '' : smoothPath(gesture.screen),
        width: inkWidthPx,
        cursor,
      });
    };
    if (frameRef.current !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      frameRef.current = requestAnimationFrame(publish);
    } else {
      // jsdom without `pretendToBeVisual`: paint synchronously instead of never.
      publish();
    }
  }, [inkWidthPx]);

  const local = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** Write what has been drawn and start the next segment from `from`. */
  const commit = (from: Point | null) => {
    const current = gestureRef.current;
    if (current === null || current.world.length === 0) {
      gestureRef.current = null;
      setPreview(null);
      return;
    }
    // A pen stroke is smoothed on commit with a tolerance measured in screen
    // pixels, so the same drag keeps twice the detail at 200 % as at 100 %.
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / zoom;
    const points = simplify(current.world, tolerance);
    const create = () => createStroke(doc, { points, color, thickness }, by);
    const id = props.undo ? props.undo.step(create) : create();
    if (id !== null) onCreated(id);
    gestureRef.current = from === null ? null : { screen: [from], world: [from] };
    if (from === null) setPreview(null);
    else schedulePreview();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    // A drag that starts on the board must not turn into a native text selection
    // or an image drag, which is how a pen stroke used to lose its first points.
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom and engines without pointer capture just skip it.
    }
    const screen = local(event);
    pointerRef.current = screen;
    gestureRef.current = { screen: [screen], world: [screenToWorld(camera, screen)] };
    schedulePreview();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const screen = local(event);
    const moved = pointerRef.current
      ? Math.hypot(screen.x - pointerRef.current.x, screen.y - pointerRef.current.y)
      : Infinity;
    pointerRef.current = screen;
    if (gesture === null) {
      // Idle, over the board: the ring still follows the pointer.
      if (moved >= MIN_POINT_DISTANCE_PX) schedulePreview();
      return;
    }
    event.stopPropagation();
    if (moved < MIN_POINT_DISTANCE_PX) return;

    // Every coalesced sample of this move is recorded: at 240 Hz a pointer reports
    // several positions between two frames, and only the last one would reach the
    // handler otherwise, shortening the stroke.
    const native = event.nativeEvent as globalThis.PointerEvent | undefined;
    const coalesced =
      typeof native?.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [native ?? null];
    let screenPoints = gesture.screen;
    let worldPoints = gesture.world;
    for (const sample of samples) {
      if (sample === null) break;
      const point = { x: sample.clientX, y: sample.clientY };
      const rect = event.currentTarget.getBoundingClientRect();
      const localPoint = { x: point.x - rect.left, y: point.y - rect.top };
      const last = screenPoints[screenPoints.length - 1];
      if (last && Math.hypot(localPoint.x - last.x, localPoint.y - last.y) < MIN_POINT_DISTANCE_PX) {
        continue;
      }
      // The event coordinates are viewport-relative; the preview is board-relative.
      screenPoints = [...screenPoints, localPoint];
      worldPoints = [...worldPoints, screenToWorld(camera, localPoint)];
      if (worldPoints.length >= STROKE_MAX_POINTS) break;
    }
    // The trailing sample of the batch is also this event's own position, which is
    // already in the batch; keep the gesture's own last point as the real one.
    gestureRef.current = { screen: screenPoints, world: worldPoints };

    if (worldPoints.length >= STROKE_MAX_POINTS) {
      // At the cap: finish this stroke and keep drawing a new one from here, so a
      // long drag becomes several sketches instead of one unbounded object.
      commit(screen);
      return;
    }
    schedulePreview();
  };

  /**
   * Ends the gesture, however it ended. A release, an interruption and a lost
   * capture all *finish* the sketch: what the pen has already put on the board is
   * written to the model rather than thrown away, because a stroke is ended by its
   * last point, not by the state of a button (PRD pen.draw). With no live gesture
   * nothing happens, so a stray event cannot invent a sketch.
   */
  const finish = () => {
    if (gestureRef.current === null) return;
    commit(null);
  };

  /** The same, for a pointer event that may need to stop before the board sees it. */
  const finishFrom = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gestureRef.current === null) return;
    event.stopPropagation();
    finish();
  };

  const onPointerLeave = () => {
    if (gestureRef.current === null) {
      pointerRef.current = null;
      setPreview(null);
    }
  };

  return (
    <div
      className="tool-overlay pen-tool-layer"
      data-testid="pen-tool"
      data-tool="pen"
      data-phase={gestureRef.current === null ? 'idle' : 'drawing'}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
        touchAction: 'none',
        cursor: 'crosshair',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishFrom}
      onPointerCancel={finishFrom}
      onPointerLeave={onPointerLeave}
      onLostPointerCapture={() => finish()}
    >
      {preview === null ? null : (
        <>
          {preview.d === '' ? null : (
          <svg
            data-testid="pen-preview"
            data-phase="drawing"
            aria-hidden="true"
            width={props.size.width}
            height={props.size.height}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              overflow: 'visible',
              pointerEvents: 'none',
            }}
          >
            <path
              data-testid="pen-preview-path"
              d={preview.d}
              fill="none"
              stroke={PEN_HEX[color]}
              strokeWidth={preview.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          )}
          <div
            data-testid="pen-cursor"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: `${preview.cursor.x - preview.width / 2}px`,
              top: `${preview.cursor.y - preview.width / 2}px`,
              width: `${preview.width}px`,
              height: `${preview.width}px`,
              borderRadius: '50%',
              border: `1px solid ${PEN_HEX[color]}`,
              opacity: 0.6,
              pointerEvents: 'none',
            }}
          />
        </>
      )}
    </div>
  );
}

/** The preview colour for an ink token. */
const PEN_HEX: Record<string, string> = {
  black: '#212121',
  blue: '#1E88E5',
  red: '#E53935',
  green: '#43A047',
  orange: '#FB8C00',
  purple: '#8E24AA',
};
