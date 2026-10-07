import { useCallback, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import * as Y from 'yjs';

import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  type PenColor,
  type PenThickness,
} from '../../shared/config.js';
import { createStroke } from '../../shared/objects/stroke.js';
import { simplify, simplifyToleranceAt, smoothPath } from '../../shared/geometry/simplify.js';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera.js';
import type { UndoController } from '../board/undo.js';

/**
 * The Pen tool (`src/client/tools/PenTool.tsx`) - the second thing on the board you
 * draw by dragging, and the first whose *shape* is whatever the hand did.
 *
 * It is a screen-space layer over the board, in the same spot the Shape tool stands in
 * and for the same reason: while it is up it owns every pointer event over the board,
 * so a stroke that starts on somebody's sticky note never moves that sticky note
 * (`pen.navigation`). It differs from the other drawing tools in one way that changes
 * the whole file - it does not go away when it has made its thing. A person holding the
 * pen is sketching, and sketching is a verb that takes several strokes; a pen that put
 * itself back to Select after the first line would be a pen you use by pressing `P`
 * again after every line (`pen.stay_active`).
 *
 * Three decisions in here are not details:
 *
 * - **the preview is local, the stroke is shared.** What grows under the pointer is a
 *   screen-space path drawn from the drag, and it is never written to the document
 *   while the pointer is down; only the finished stroke goes to the document, and so to
 *   everybody else (`pen.share`). Everything about a live stroke - every point, every
 *   wobble - is worth nothing until the person lets go, and sending it would be paying
 *   for it on every screen in the room.
 * - **one animation frame, one preview.** A 120 Hz pointer is 120 path recomputations a
 *   second and a screen that can show sixty of them; points are collected as they
 *   arrive, coalesced samples and all, and the drawing catches up once per frame.
 * - **a limit that keeps drawing.** At {@link STROKE_MAX_POINTS} the stroke so far is
 *   committed and a new one is started from the same point, so a long drag becomes two
 *   objects that *draw* as one - the join point is shared, and the round cap of one
 *   lands under the round cap of the other. The alternative, stopping at the limit, is
 *   the tool deciding to be deaf in the middle of what the person was drawing.
 *
 * The drag lives in a ref and the preview in state, as in `ShapeTool.tsx`: the release
 * is a side effect that writes the document, and a React state updater may run more than
 * once for one event, which would draw two strokes where one line was drawn.
 */

/** Only this pointer button draws. */
const PRIMARY_BUTTON = 0;

/** The drag, as the pen describes it: a trail in board units and two screen points. */
interface Drag {
  pointerId: number;
  /** The trail so far, in world units. */
  points: Point[];
  /** Where the pen went down, in screen pixels - the drag the dot-vs-line question is asked of. */
  first: Point;
  /** Where the pen last was, in screen pixels. */
  last: Point;
  /** Whether the pen has travelled far enough to have drawn a line rather than a dot. */
  moved: boolean;
}

/** What one frame of the preview shows: the trail as path data, in screen pixels. */
interface Preview {
  /** The `d` of the preview path, in screen coordinates. */
  d: string;
  /** Where the pen is, in screen pixels: the ring that says where this stroke would start. */
  cursor: Point;
  /** How many raw points the trail holds, for a test that wants to know the pen is still listening. */
  raw: number;
}

/** A native pointer event, plus the samples the browser merged into it if it has any. */
interface CoalescingPointerEvent {
  clientX: number;
  clientY: number;
  getCoalescedEvents?: () => CoalescingPointerEvent[];
}

export interface PenToolProps {
  doc: Y.Doc;
  /** The camera, so the trail is stored in board units and drawn in screen ones. */
  camera: Camera;
  /** The ink and the pen, which belong to the tab (`pen.options`). */
  color: PenColor;
  thickness: PenThickness;
  /** This tab's undo history, so one stroke is one Ctrl+Z. */
  undo?: UndoController;
  /** Whose id is written on the stroke as its creator; nobody in this build has a name. */
  identityId?: string;
}

export function PenTool({
  doc,
  camera,
  color,
  thickness,
  undo,
  identityId = '',
}: PenToolProps): JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** The frame the preview is waiting for, as a token; 0 is "no frame pending". */
  const frameRef = useRef(0);
  const tokenRef = useRef(0);
  // Everything the gesture reads is read through a ref, because the gesture is longer
  // than the render that started it: a pen whose colour is read from the closure of the
  // render that began the drag is a pen that draws in last week's ink if the swatch was
  // clicked mid-drag.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const docRef = useRef(doc);
  docRef.current = doc;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;

  /** Screen pixels relative to the board area. */
  const local = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return { x: event.clientX, y: event.clientY };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  /** The trail as it is drawn: board units to screen pixels, then the curve through them. */
  const previewOf = (drag: Drag): Preview => {
    const cameraNow = cameraRef.current;
    const screen = drag.points.map((point) => worldToScreen(cameraNow, point));
    return { d: smoothPath(screen), cursor: drag.last, raw: drag.points.length };
  };

  /**
   * Draw the preview on the next frame, unless a frame is already waiting.
   *
   * The token, not the handle, is what makes a stale frame harmless: jsdom's
   * `cancelAnimationFrame` is a no-op and every browser is allowed to deliver a frame
   * that was cancelled at the moment it was already running, so the callback asks
   * whether it is still the one that was asked for before it draws anything.
   */
  const schedulePreview = useCallback(() => {
    if (frameRef.current !== 0) return;
    const token = ++tokenRef.current;
    frameRef.current = token;
    requestAnimationFrame(() => {
      if (frameRef.current !== token) return;
      frameRef.current = 0;
      const drag = dragRef.current;
      setPreview(drag === null ? null : previewOf(drag));
    });
  }, []);

  /** Stop waiting for a frame: the gesture is over, whatever is queued is history. */
  const dropPreviewFrame = useCallback(() => {
    if (frameRef.current === 0) return;
    const token = frameRef.current;
    frameRef.current = 0;
    cancelAnimationFrame(token);
  }, []);

  /**
   * Write one stroke to the document: one undo step, bounded on both sides so the
   * frames of one drag merge into it and nothing after it joins in. A stroke the model
   * refused leaves the pen exactly where it was - the person is still holding the pen
   * they were holding, with nothing on the board and nothing in their undo history.
   */
  const commit = useCallback((points: Point[]): void => {
    const history = undoRef.current;
    history?.boundary();
    createStroke(
      docRef.current,
      { points, color: colorRef.current, thickness: thicknessRef.current },
      identityRef.current,
    );
    history?.boundary();
    // A stroke is never selection content while the pen is up: the person is drawing,
    // not arranging. `tools.toolCreated` - which selects and returns to Select - is
    // deliberately not called here, which is what `pen.stay_active` comes down to.
  }, []);

  /**
   * The limit was reached: commit the trail so far and carry on drawing from its last
   * point (`pen.long_stroke`). The two objects share that point, which is what makes
   * them read as one line, and the pen keeps collecting either way - a person who drew
   * six thousand points asked for a line of six thousand points.
   */
  const splitAtLimit = useCallback((drag: Drag) => {
    const cameraNow = cameraRef.current;
    const trail = drag.points;
    const tolerance = simplifyToleranceAt(cameraNow.zoom);
    const join = trail[trail.length - 1];
    commit(simplify(trail, tolerance));
    drag.points = [join];
  }, [commit]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== PRIMARY_BUTTON) return;
    // Touch-screen navigation is out of scope for the board (see PRD).
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    // The pen takes the press for the whole board: nothing under it pans, and nothing
    // under it is picked up.
    event.stopPropagation();
    const point = local(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const world = screenToWorld(cameraRef.current, point);
    dragRef.current = {
      pointerId: event.pointerId,
      points: [world],
      first: point,
      last: point,
      moved: false,
    };
    // The preview says the pen is down and drawing, at the size the ink is: a path of
    // no length with a round cap is a dot, which is exactly what letting go here makes.
    setPreview(previewOf(dragRef.current));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    // Every sample the browser is holding: a fast drag arrives as one event per frame
    // carrying a dozen points, and the ones it merged away are the shape of the line.
    const native = event.nativeEvent as unknown as CoalescingPointerEvent;
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [native];
    const cameraNow = cameraRef.current;
    for (const sample of samples) {
      const point = local(sample);
      drag.points.push(screenToWorld(cameraNow, point));
      drag.last = point;
      if (
        !drag.moved &&
        (point.x - drag.first.x) ** 2 + (point.y - drag.first.y) ** 2 >=
          DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
      ) {
        drag.moved = true;
      }
    }
    if (drag.points.length >= STROKE_MAX_POINTS) splitAtLimit(drag);
    schedulePreview();
  };

  /**
   * Let go: the stroke is written, the preview is gone, the pen stays the pen.
   *
   * A release that never travelled is a dot (`pen.dot`) and is committed as one point,
   * not as the two or three a hand at rest still reports; anything else is simplified
   * first, and the tolerance is one *screen* pixel at the zoom it was drawn at
   * (`pen.smooth`), so the same drag at 400% keeps four times the points and the same
   * line looks the same either way.
   */
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    dropPreviewFrame();
    setPreview(null);
    if (drag === null || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = local(event);
    const last = drag.points[drag.points.length - 1];
    const cameraNow = cameraRef.current;
    const world = screenToWorld(cameraNow, point);
    // The release point belongs to the line - unless it is the place the last move
    // already left the pen at, which is the usual case and adds nothing but a point.
    if (last.x !== world.x || last.y !== world.y) drag.points.push(world);
    if (!drag.moved) {
      commit([drag.points[0]]);
      return;
    }
    const tolerance = simplifyToleranceAt(cameraNow.zoom);
    commit(simplify(drag.points, tolerance));
  };

  /**
   * The gesture was taken away mid-stroke (`pen.interrupted`): the stroke so far is
   * kept, exactly as it stands, which is the same answer the board gives when a note
   * drag is cancelled at the edge of the window - the person drew it, and what they drew
   * is on the board. Nothing is added: the pointer is no longer describing a line, so
   * the line ends where it was last heard.
   */
  const finishInterrupted = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    dropPreviewFrame();
    setPreview(null);
    event.stopPropagation();
    if (!drag.moved) {
      commit([drag.points[0]]);
      return;
    }
    const cameraNow = cameraRef.current;
    const tolerance = simplifyToleranceAt(cameraNow.zoom);
    commit(simplify(drag.points, tolerance));
  };

  // `lostpointercapture` follows every `pointerup` in a browser. By then the release
  // has already committed and cleared the drag, which is why this answers nothing at
  // all in that case; it is the path for a capture taken away by something else, the
  // one case in which a stroke would otherwise be drawn and never finished.
  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    finishInterrupted(event);
  };

  const ink = PEN_COLORS[color];
  const inkWidth = PEN_THICKNESS_WORLD[thickness] * (camera.zoom > 0 ? camera.zoom : 1);

  return (
    <div
      ref={surfaceRef}
      className="tool-surface pen-surface"
      data-testid="pen-tool-surface"
      data-tool="pen"
      data-color={color}
      data-thickness={thickness}
      role="presentation"
      aria-label="Drawing with the pen"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={finishInterrupted}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/* What the pen has drawn so far, in screen pixels, and never in the document: the
          shape of a stroke a person is still drawing is not board content. The svg is the
          whole of the preview - the line and the tip of the pen - and it is deaf to the
          pointer, because the surface underneath is what the pointer is talking to. */}
      {preview !== null ? (
        <svg className="pen-preview" aria-hidden="true">
          <path
            className="pen-preview-path"
            data-testid="pen-preview"
            data-points={String(preview.raw)}
            data-color={color}
            data-thickness={thickness}
            d={preview.d}
            fill="none"
            stroke={ink}
            strokeWidth={inkWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* The pen held up to the paper: a ring the size the ink will be, so the width
              chosen in the option bar is visible at the hand before any of it is on the
              board. */}
          <circle
            className="pen-cursor"
            data-testid="pen-cursor"
            cx={preview.cursor.x}
            cy={preview.cursor.y}
            r={Math.max(inkWidth / 2, 3)}
            fill="none"
            stroke={ink}
            strokeWidth={1}
          />
        </svg>
      ) : null}
    </div>
  );
}

export default PenTool;
