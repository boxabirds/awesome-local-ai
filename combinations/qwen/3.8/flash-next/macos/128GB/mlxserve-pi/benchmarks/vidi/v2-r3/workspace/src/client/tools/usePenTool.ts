// The Pen tool: a drag on the board is a drawing, and nothing else.
//
// It watches the pointer on the window, in the capturing phase, and stops every
// event it is acting on — the same way the Shape tool and the Connector tool own
// their drags, for the same reason. A pen stroke is drawn over what is already on
// the board, and a tool that listened further down would hear nothing whenever it
// was pointed at a note, which is most of where a sketch is drawn. Stopping the
// event here is also the whole of the two navigation rules: the board never pans
// under a pen drag and no note moves under one, because the board never sees it.
// Wheel and pinch are not pointer events, so scroll-to-pan and pinch-to-zoom go on
// working while the pen is in use, exactly as story 1 left them.
//
// What is held during a drag is a local array of board points and a preview drawn
// once per animation frame. Nothing is written to the document while the pointer is
// down: an unfinished stroke that was synced would be a stroke everybody else
// watched being drawn, and a stroke that arrived in pieces would be a drawing that
// arrived wrong. Only the finished stroke goes to the model — one call, one
// transaction, one undo step.
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { createStroke } from '../../shared/objects/stroke';
import { simplify } from '../../shared/geometry/simplify';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface PenToolOptions {
  doc: Y.Doc;
  /** The camera the points are converted with, read at each event: the board can
   *  be zoomed in the middle of a stroke by the wheel, and a stroke that went on
   *  recording in the old scale would be a drawing drawn twice. */
  camera: Camera;
  /** The Pen tool is the board's active tool. */
  active: boolean;
  /** The board can be written to. A tool that cannot be used is not entered. */
  canEdit: boolean;
  /** The pen chosen in the toolbar, read when a stroke is finished. */
  color: PenColor;
  thickness: PenThickness;
  undo?: UndoController;
  /** A stroke was committed. The board stays in the Pen tool: what a pen does is
   *  draw the next stroke, so nothing here goes back to Select. */
  onCommitted?(id: string): void;
}

export interface PenToolResult {
  /**
   * The stroke in flight, as board points, or null when nothing is being drawn.
   * Local only: it is what the preview is drawn from and it never reaches the
   * document, the undo history or anybody else's screen.
   */
  preview: readonly Point[] | null;
  /** The pen this stroke is being drawn with — the one in hand when the pointer went
   *  down, which is the one the stroke will be saved in. It is handed to the preview
   *  so that the line on the screen and the line that gets saved are the same colour
   *  and the same width; a preview that changed colour halfway through the drag would
   *  be a preview that promised a stroke it was not going to draw. */
  previewPen: { color: PenColor; thickness: PenThickness } | null;
}

/** The drag in flight. The points are board units, so that a zoom in the middle of
 *  a stroke cannot move the line already drawn; the screen pair is only kept to
 *  measure how far the pointer travelled, which is a thing in pixels. The pen is
 *  taken at the press and kept: a stroke is drawn with the pen it was begun with,
 *  and a swatch pressed while the line is in flight belongs to the next stroke, the
 *  way a pen with a swappable refill belongs to the next line rather than this one. */
interface Stroke {
  pointerId: number;
  points: Point[];
  downX: number;
  downY: number;
  x: number;
  y: number;
  /** How far the pointer has travelled along the path it took, in screen pixels. Not
   *  how far it is from where it started: a circle comes back to where it began, and a
   *  pen that read a closed loop as a click because its ends met would be a pen that
   *  could not draw circles. */
  travel: number;
  color: PenColor;
  thickness: PenThickness;
}

export function usePenTool(options: PenToolOptions): PenToolResult {
  const [preview, setPreview] = useState<readonly Point[] | null>(null);
  const [previewPen, setPreviewPen] = useState<{ color: PenColor; thickness: PenThickness } | null>(null);
  const opts = useRef(options);
  const stroke = useRef<Stroke | null>(null);
  /** The frame the preview is waiting for, so a burst of 200 pointer moves redraws
   *  it 200 times at most — and in practice once per frame, which is all the eye has. */
  const frame = useRef<number | null>(null);

  useEffect(() => {
    opts.current = options;
  });

  /** Stop waiting for a frame that is no longer wanted. */
  const dropFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  useEffect(() => {
    if (!options.active || !options.canEdit) return;

    /** The board's surface, when this event is a press on it or on something in it. */
    const surfaceOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      // A press on a toolbar belongs to that toolbar, and a press in a box being
      // typed into belongs to the typing: neither is a drawing.
      if (target.closest('[role="toolbar"]') !== null) return null;
      if (target.closest('textarea') !== null) return null;
      return target.closest<HTMLElement>('[data-testid="board-viewport"]');
    };

    /** Screen pixels relative to the surface, which is the space the camera works in. */
    const relative = (surface: HTMLElement, clientX: number, clientY: number): Point => ({
      x: clientX - surface.getBoundingClientRect().left,
      y: clientY - surface.getBoundingClientRect().top,
    });

    /** The points as they are now, on the next frame. */
    const redraw = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const held = stroke.current;
        setPreview(held === null ? null : [...held.points]);
        setPreviewPen(held === null ? null : { color: held.color, thickness: held.thickness });
      });
    };

    /** Every point this event carries, as places on the screen, in the order the
     *  pointer made them. A pointer that is moving fast reports the places it passed
     *  between two events, and a stroke that recorded only where the events landed
     *  would be a stroke with corners in it that nobody drew. */
    const coalesced = (e: PointerEvent, surface: HTMLElement): Point[] => {
      const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = batch.length > 0 ? batch : [e];
      return events.map((event) => relative(surface, event.clientX, event.clientY));
    };

    /** One more place the pointer was, added to the stroke in flight — in the units of
     *  the board, at the zoom it is drawn at right now, so a stroke keeps its shape
     *  when the wheel is used halfway across it. */
    const add = (held: Stroke, screen: Point) => {
      held.travel += Math.hypot(screen.x - held.x, screen.y - held.y);
      held.x = screen.x;
      held.y = screen.y;
      held.points.push(screenToWorld(opts.current.camera, screen));
      // The limit of one stroke is the limit of one object; reaching it does not stop
      // the drawing, it finishes this stroke and begins the next one from the same
      // last point, so the two lines meet on the board with no gap.
      if (held.points.length >= STROKE_MAX_POINTS) commitPart(held);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) return;
      const surface = surfaceOf(e.target);
      if (surface === null) return;
      const from = relative(surface, e.clientX, e.clientY);
      stroke.current = {
        pointerId: e.pointerId,
        points: [screenToWorld(opts.current.camera, from)],
        downX: from.x,
        downY: from.y,
        x: from.x,
        y: from.y,
        travel: 0,
        color: opts.current.color,
        thickness: opts.current.thickness,
      };
      // Nothing else is to see this drag: not the viewport, which would pan, and
      // not the note under the pointer, which would start moving itself.
      e.stopPropagation();
      e.preventDefault();
      // So that the pointer keeps reporting to the board when it leaves the window,
      // and so that `lostpointercapture` is a thing that can happen to this stroke.
      try {
        surface.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported: the window listeners will still hear the release */
      }
      redraw();
    };

    const onPointerMove = (e: PointerEvent) => {
      const held = stroke.current;
      if (held === null || e.pointerId !== held.pointerId) return;
      const surface = surfaceOf(e.target) ?? document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (surface === null) return;
      e.stopPropagation();

      const points = coalesced(e, surface);
      for (const screen of points) add(held, screen);
      redraw();
    };

    /** One part of a stroke that has reached its limit: committed as it stands,
     *  with the drawing carrying on from the point the part ended at. */
    const commitPart = (held: Stroke) => {
      const part = held.points;
      const last = part[part.length - 1]!;
      const id = write(part, held);
      if (id !== null) opts.current.onCommitted?.(id);
      held.points = [last];
    };

    /** The whole of a stroke, from the points the pointer went through. */
    const write = (points: readonly Point[], held: Stroke): string | null => {
      const current = opts.current;
      const drawn = points.map((point) => ({ x: point.x, y: point.y }));
      // Simplified at the zoom it was drawn at: one screen pixel of forgiveness at
      // 200 % is half a board unit, and the drawing keeps both.
      const zoom = current.camera.zoom > 0 ? current.camera.zoom : 1;
      const kept = simplify(drawn, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
      current.undo?.boundary();
      const id = createStroke(current.doc, {
        points: kept,
        color: held.color,
        thickness: held.thickness,
      });
      current.undo?.boundary();
      // A stroke the model refused — nothing in it, or a number that is not a number
      // — leaves nothing behind. Not an error, not a half-drawn line, not a preview.
      return id;
    };

    /** Finish the stroke: what was drawn is a stroke, even if the pointer was taken
     *  away from us to do it. */
    const finish = (e: PointerEvent) => {
      const held = stroke.current;
      if (held === null || e.pointerId !== held.pointerId) return;
      stroke.current = null;
      dropFrame();
      e.stopPropagation();
      setPreview(null);
      setPreviewPen(null);
      try {
        surfaceOf(e.target)?.releasePointerCapture(e.pointerId);
      } catch {
        /* already released, or never captured */
      }

      const travelled = held.travel;
      // A press and a release with less than a drag's movement between them is a
      // dot: one point, of the pen's own thickness, where the pointer went down. The
      // measuring is of the road travelled, so that a loop that came back to where it
      // started is a loop and not a dot. Everything else is the line the pointer took,
      // thinned to what it needs.
      const points = travelled < DRAG_THRESHOLD_PX ? [held.points[0]!] : held.points;
      if (points.length === 0) return;
      const id = write(points, held);
      if (id !== null) opts.current.onCommitted?.(id);
    };

    /** A capture lost is a release we did not choose: the stroke is kept. */
    const onLostCapture = (e: Event) => {
      const held = stroke.current;
      if (held === null || (e as PointerEvent).pointerId !== held.pointerId) return;
      // `finish` stops propagation and releases a capture that is already gone;
      // both are harmless here, and a second copy of the finishing would be a
      // stroke committed twice.
      finish(e as PointerEvent);
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', finish, { capture: true });
    window.addEventListener('pointercancel', finish, { capture: true });
    window.addEventListener('lostpointercapture', onLostCapture, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', finish, { capture: true });
      window.removeEventListener('pointercancel', finish, { capture: true });
      window.removeEventListener('lostpointercapture', onLostCapture, { capture: true });
      dropFrame();
      // Leaving the tool — by Escape, by the toolbar, by a shortcut — abandons the
      // stroke in flight and draws nothing with it: a stroke left half-drawn is a
      // stroke that was not finished, and the pen does not finish things by accident.
      stroke.current = null;
      setPreview(null);
      setPreviewPen(null);
    };
    // Everything the stroke needs is read from `opts`, so that a camera that moved
    // mid-drag, a colour pressed mid-drag or a document that was swapped mid-drag
    // are all answered without re-arming the listeners under the drag in flight.
  }, [options.active, options.canEdit, dropFrame]);

  return { preview, previewPen };
}

/** The diameter of the pen's cursor, in screen pixels, at this zoom. */
export function penCursorSize(thickness: PenThickness, zoom: number): number {
  return Math.max(2, PEN_THICKNESS_WORLD[thickness] * (zoom > 0 ? zoom : 1));
}
