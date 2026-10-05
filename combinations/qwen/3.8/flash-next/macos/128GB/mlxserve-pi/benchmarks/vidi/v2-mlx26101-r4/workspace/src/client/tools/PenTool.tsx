/**
 * The Pen tool: the pointer becomes a pen for as long as the tool is armed.
 *
 * Like the Shape and Connector tools, this is a sheet laid over the board while the tool is up — and, as with
 * those two, the sheet is not a detail, it is the mechanism. Everything under it stops being reachable: a press
 * that lands on a sticky note with the Pen armed draws a line over that note and leaves the note where it is,
 * because the press is never handed to it. That is how `pen.navigation` ("a Pen drag never pans the board or
 * moves objects") is satisfied without this file containing a single rule about not panning: the board never
 * hears the press, so there is nothing here that could get panning wrong. The wheel is a different matter — the
 * sheet does not listen for it, so it bubbles to the viewport and scroll still pans and Ctrl/Cmd+scroll still
 * zooms, untouched from story 1.
 *
 * **The preview is local, the stroke is shared.** While the pointer travels, nothing is written to the document:
 * the line on the screen is drawn from a local array of points in screen units, once per animation frame. Two
 * things follow, and both are the story. Nobody else sees a half-finished drawing (`pen.share`) — a stroke
 * arrives in other people's browsers as one finished object, in one transaction, which is also why a stroke
 * that gets cancelled leaves nothing behind on five screens. And the preview can be redrawn sixty times a
 * second without costing the network a single message.
 *
 * **The frame is the unit of drawing, not the event.** A tablet reports a hundred and more points a second; a
 * screen shows sixteen frames a second. Points are appended as they arrive (coalesced events included, because
 * those are where a tablet's detail lives) and the picture is redrawn once per frame, which is what "the line
 * follows the pointer" means when it means anything: at least once per frame displayed, and no more work than
 * the display can show.
 *
 * **It does not step aside when it succeeds.** Every other tool hands its object to the selection and returns
 * to Select, because a shape is something you then move or label; the pen is the one tool that is expected to
 * be used twice in a row — an annotation is rarely one line. So `onCreated` is told about the new stroke (it is
 * what the selection gets) and the tool stays exactly where it is. `pen.stay_active` is the whole of the
 * difference, and it is a difference between the name of a callback and nothing else, which is why this file
 * calls `onCreated` where `ShapeTool` calls `toolCreated`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';

import { DRAG_THRESHOLD_PX, PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import type { Point } from '../../shared/geometry';
import type { Camera } from '../canvas/camera';
import { worldToScreen } from '../canvas/camera';
import type { UndoActions } from '../board/undo';
import { toolOverlayStyle, toolOverlaySvgStyle, worldOfOverlay } from './toolOverlay';

/** The mouse button that draws. */
const PRIMARY_MOUSE_BUTTON = 0;

/** The biggest cursor image any browser will draw for us; beyond it the dot stops being the nib's size. */
const MAX_CURSOR_PX = 32;
/** The smallest cursor worth showing: a two-unit nib at ten per cent zoom would be a dot of a tenth of a pixel. */
const MIN_CURSOR_PX = 6;

export interface PenToolProps {
  /** The board to draw on. Written to through the model, never directly. */
  doc: Y.Doc;
  /** The camera this frame is drawn with, for turning the pointer's position into a place on the board. */
  camera: Camera;
  /** The ink and the nib the next stroke will be drawn with. */
  color: PenColor;
  thickness: PenThickness;
  /** Who is drawing, stored as `createdBy`. Left out, it is this document's client id — as a shape's is. */
  identityId?: string;
  /**
   * This person's undo history, in the form an object is given.
   *
   * Used for one thing: a boundary closed after each committed stroke, so forty lines sketched in a row are
   * forty undoes and not one. Optional because the tool can be drawn somewhere with no history behind it.
   */
  undo?: UndoActions;
  /**
   * A stroke was committed. The board selects it; the tool stays armed, which is the one thing this tool does
   * differently from every other drawing tool and the reason the callback is not called `onCreated`+step-aside.
   */
  onCreated?(id: string): void;
}

/** The press being drawn: where it went down on the screen, and whether it has travelled enough to be a line. */
interface Press {
  pointerId: number;
  /** Where the pen came down, in client pixels — the origin the drag threshold is measured from. */
  x: number;
  y: number;
  /**
   * Whether the pointer has been far enough from the down point to be a stroke rather than a dot.
   *
   * Sticky, and measured against the *down point* rather than between consecutive points, for two reasons that
   * are the same reason: a dot is a press-and-release that went nowhere, which is a question about the whole
   * gesture; and a loop comes back to where it started, so a threshold measured between the first and the last
   * point would call a hand-drawn circle a click and hand back a dot.
   */
  moved: boolean;
}

/** A pointer event's coalesced events, or the event itself when the browser has nothing to add. */
function coalesced(event: PointerEvent): PointerEvent[] {
  const read = (event as { getCoalescedEvents?: () => PointerEvent[] }).getCoalescedEvents;
  if (typeof read !== 'function') return [event];
  let batch: PointerEvent[] | null = null;
  try {
    batch = read.call(event);
  } catch {
    batch = null;
  }
  // A batch that came back empty is a browser being clever about an event it has already folded into another
  // one; the event in hand is still a place the pen was, and dropping it would shorten the line.
  return batch !== null && batch.length > 0 ? batch : [event];
}

/** How far the pointer has travelled from where it came down, in screen pixels. */
function travelled(press: Press, event: { clientX: number; clientY: number }): number {
  return Math.max(Math.abs(event.clientX - press.x), Math.abs(event.clientY - press.y));
}

/**
 * The cursor: a round dot the size of the nib at this zoom, in the ink it will draw.
 *
 * Crosshair would be a lie — the pen draws a round dot, and how big that dot is on the board is the one thing
 * a person choosing between thin and thick has to judge before drawing. So the cursor *is* the nib: the same
 * diameter the stroke will have, which at 400% is four times the size it is at 100% and looks exactly like the
 * line being drawn. Clamped into the range browsers agree to draw, and falling back to crosshair everywhere a
 * data-URL cursor is not supported (Safari), which costs a person a preview of their nib and nothing else.
 */
export function penCursor(color: PenColor, thickness: PenThickness, zoom: number): string {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const size = Math.max(MIN_CURSOR_PX, Math.min(MAX_CURSOR_PX, Math.round(PEN_THICKNESS_WORLD[thickness] * scale)));
  const centre = size / 2;
  const radius = Math.max(1, centre - 1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<circle cx="${centre}" cy="${centre}" r="${radius}" fill="${PEN_COLORS[color]}" stroke="white" stroke-width="1"/>` +
    `</svg>`;
  const hotspot = Math.floor(centre);
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotspot} ${hotspot}, crosshair`;
}

export function PenTool({
  doc,
  camera,
  color,
  thickness,
  identityId,
  undo,
  onCreated,
}: PenToolProps): JSX.Element {
  const overlayRef = useRef<HTMLDivElement>(null);

  /** Whether the pen is down, which is the only thing that decides whether a preview is drawn. */
  const [drawing, setDrawing] = useState(false);
  // Bumped once per animation frame while there is new ink to show. The points themselves are not in state:
  // they arrive faster than React is willing to render, and a stroke of five thousand points kept in a state
  // object would be five thousand re-renders of an array. One counter, and the picture read from the ref, is
  // the difference between a pen and a pen that freezes the board.
  const [, setFrame] = useState(0);

  /** Where the pen has been since the last commit, in board units. */
  const points = useRef<Point[]>([]);
  /** The gesture in hand, or none. */
  const press = useRef<Press | null>(null);
  /** The frame already scheduled, so a hundred moves ask for one redraw. */
  const frame = useRef<number | null>(null);
  /** Whether points arrived since the last frame — the only reason to redraw at all. */
  const dirty = useRef(false);

  // Read from refs inside the window listeners, which are installed once per gesture: the camera and the
  // options a stroke is drawn with belong to the moment the pointer moved, not to the render that happened to
  // be current when the pen came down. A pinch-zoom mid-drag would otherwise store points at the old zoom.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;
  const undoRef = useRef(undo);
  undoRef.current = undo;
  const createdRef = useRef(onCreated);
  createdRef.current = onCreated;

  /** Where this pointer event is on the board. */
  const worldOf = useCallback(
    (event: { clientX: number; clientY: number }): Point => worldOfOverlay(overlayRef, cameraRef.current, event),
    [],
  );

  /**
   * Redraw the preview on the next frame, once.
   *
   * The handle is kept so the frame can be cancelled when the gesture ends: a callback that fires after the
   * component has stopped drawing would call `setFrame` on a tool that has nothing left to draw.
   */
  const scheduleFrame = useCallback((): void => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      // Nothing new since the last frame: nothing to redraw, and no render to ask React for.
      if (!dirty.current) return;
      dirty.current = false;
      setFrame((n) => n + 1);
    });
  }, []);

  const cancelFrame = useCallback((): void => {
    if (frame.current === null) return;
    cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  /**
   * Put one finished stroke in the document.
   *
   * The thinning happens here and nowhere else, and against the zoom drawn *at*: `simplify` is told
   * `STROKE_SIMPLIFY_TOLERANCE_PX / zoom`, which is what makes the promise in `pen.smooth` a promise — every
   * point the pen visited is within one screen pixel of the line that gets stored. Dividing rather than
   * multiplying, because the tolerance is a fact about a screen and the points are a fact about the board.
   *
   * The boundary closed after the write is what makes each stroke an undo step of its own; a stroke that was
   * undone together with the one before it would be a drawing that cannot be taken back a line at a time.
   */
  const commit = useCallback(
    (drawn: readonly Point[]): string | null => {
      if (drawn.length === 0) return null;
      const zoom = cameraRef.current.zoom;
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
      const id = createStroke(
        doc,
        {
          points: simplify(drawn, tolerance),
          color: colorRef.current,
          thickness: thicknessRef.current,
        },
        // Who drew it, the way every other object records it: anonymised to the board's own client id when
        // this build has no identity to offer.
        identityRef.current ?? String(doc.clientID),
      );
      // Each finished stroke is one undo step, and the only thing that says so is a closed capture window.
      // Without it two lines drawn within the pause that ends a typing burst would come back together, which
      // is right for typing and wrong for drawing: nobody draws a second line because they meant the first one
      // to be longer. It goes after the write rather than before, so that a stroke is never split from the
      // selection change that follows it, and it is called for every part of a stroke that had to be split.
      undoRef.current?.boundary();
      if (id !== null) createdRef.current?.(id);
      // A stroke that was refused — points that were not points, an option that was not an option — is
      // dropped with no message, and the preview has already gone. BoardPage's status badge is where a board
      // that cannot be written to says so; this tool has nothing to add, and a dialog about a line that is not
      // there is a worse answer than a line that is not there.
      return id;
    },
    [doc],
  );

  /**
   * Commit the parts that have reached the limit, and carry on from the last point of the last one.
   *
   * Five thousand points is a document nobody wants to download, and a gesture past it is a scribble rather
   * than a stroke. So the limit is a limit on a *record* and never on a drawing: what has been drawn is
   * committed as it stands and the pen carries on from the same point, which is why a line long enough to be
   * two records still looks like one line — the join is shared, so there is no gap and no double paint.
   */
  const splitOffParts = useCallback((): void => {
    // A loop rather than a single split: a tablet can put more than one limit's worth of points between two
    // frames, and the drawing must not keep what does not fit just because it arrived quickly.
    while (points.current.length >= STROKE_MAX_POINTS) {
      const part = points.current.slice(0, STROKE_MAX_POINTS);
      const rest = points.current.slice(STROKE_MAX_POINTS);
      commit(part);
      points.current = [part[part.length - 1] as Point, ...rest];
    }
  }, [commit]);

  /**
   * The gesture is over: draw the last stroke and forget the preview.
   *
   * Three ways here, all of them this: the pointer let go, the pointer was cancelled, or the capture was taken
   * away. The first two are what a person expects; the third is what a tablet and a system dialog do, and
   * `pen.interrupted` is explicit that points drawn so far are kept rather than discarded — a hand that was
   * pulled away from the board did not un-draw the line.
   *
   * A press that never travelled is a dot: one point, which is what a period is made of.
   */
  const finish = useCallback(
    (event: PointerEvent | null): void => {
      const pressed = press.current;
      press.current = null;
      cancelFrame();
      setDrawing(false);
      if (pressed === null) return;
      if (event !== null && event.pointerId !== pressed.pointerId) {
        // Somebody else's release: this gesture is still being drawn and is not this event's business.
        return;
      }
      dirty.current = false;
      // Whatever reached the limit is committed *first*, so that a gesture that ends past the limit still
      // produces its parts rather than losing everything but the tail.
      splitOffParts();
      const drawn = points.current;
      points.current = [];
      // A gesture that ended exactly on the limit boundary has one point left in hand — the join, which
      // becomes a dot underneath the end of the line that already paints over it. Invisible, and cheaper
      // than a special case that would have to explain why the last dot is not a stroke.
      if (drawn.length === 0) return;
      commit(pressed.moved ? drawn : [drawn[0] as Point]);
    },
    [cancelFrame, commit, splitOffParts],
  );

  const begin = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON) return;
    // The press stops here: the board does not pan, no rectangle starts, and whatever object is underneath is
    // not pressed. See the header note about what a sheet is for.
    event.stopPropagation();
    const at = worldOf(event.nativeEvent);
    press.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    points.current = [at];
    // Held so the moves keep arriving after the pointer leaves the board — over the toolbar, off the window —
    // and so the release is seen wherever it happens. Guarded because a browser that has no capture (jsdom,
    // before the shim) must not lose the gesture over an API it never had.
    const surface = overlayRef.current;
    if (typeof surface?.setPointerCapture === 'function') {
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // A capture that could not be taken is a capture that is not needed: the listeners below are on the
        // window and already follow the pointer anywhere it goes.
      }
    }
    // The dot appears now, without waiting for a frame: the pen came down, and the first thing a person looks
    // for is the mark they made.
    setDrawing(true);
  };

  // Moves, releases and cancels are listened for on the window, in the capture phase, only while the pen is
  // down — the same arrangement the Shape tool uses, and for the same reason: a drag that leaves the board has
  // to keep drawing and has to finish properly wherever it happens to let go.
  useEffect(() => {
    if (!drawing) return;

    const onMove = (event: PointerEvent): void => {
      const pressed = press.current;
      if (pressed === null || event.pointerId !== pressed.pointerId) return;
      for (const point of coalesced(event)) {
        if (!pressed.moved && travelled(pressed, point) >= DRAG_THRESHOLD_PX) pressed.moved = true;
        points.current.push(worldOf(point));
      }
      dirty.current = true;
      scheduleFrame();
    };

    const onUp = (event: PointerEvent): void => {
      if (press.current === null || event.pointerId !== press.current.pointerId) return;
      finish(event);
    };

    // Cancelled (a system gesture, a second finger, the browser deciding) is a finish, not an undo: see
    // `finish`. The points so far are the drawing, and the drawing is kept.
    const onCancel = (event: PointerEvent): void => {
      if (press.current === null || event.pointerId !== press.current.pointerId) return;
      finish(null);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('lostpointercapture', onCancel, true);
    return () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      window.removeEventListener('lostpointercapture', onCancel, true);
    };
  }, [drawing, scheduleFrame, finish, worldOf]);

  // Nothing was scheduled while the pen was up, and nothing may be left scheduled when it goes away — including
  // when the tool itself is unmounted mid-stroke (Escape, or `V`), which is exactly when a stray frame callback
  // would find a component that has stopped drawing.
  useEffect(() => cancelFrame, [cancelFrame]);

  // The preview, in screen units, from the points in board units: converted at render so that a board panned
  // or zoomed mid-drag keeps the line under the pointer instead of leaving it where the drag started. The
  // curve is the one a finished stroke is drawn with, so the line does not change shape when the pen lets go.
  const preview = drawing && points.current.length > 0 ? smoothPath(points.current.map((p) => worldToScreen(camera, p))) : null;

  return (
    <div
      ref={overlayRef}
      className="tool-overlay tool-overlay--pen"
      data-testid="pen-tool"
      data-pen-color={color}
      data-pen-thickness={thickness}
      style={{ ...toolOverlayStyle, cursor: penCursor(color, thickness, camera.zoom) }}
      onPointerDown={begin}
      onLostPointerCapture={(event) => {
        // Only the browser's own taking-away reaches this: `finish` releases nothing, and React's synthetic
        // event does not fire for a capture that was never taken.
        if (press.current === null || event.pointerId !== press.current.pointerId) return;
        finish(null);
      }}
    >
      {preview === null ? null : (
        <svg style={toolOverlaySvgStyle} data-testid="pen-preview" aria-hidden="true" focusable="false">
          <path
            data-testid="pen-preview-path"
            d={preview}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}
