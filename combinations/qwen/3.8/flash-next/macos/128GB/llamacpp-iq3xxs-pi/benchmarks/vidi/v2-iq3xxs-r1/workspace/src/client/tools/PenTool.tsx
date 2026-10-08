import { useEffect, useRef, useState, type JSX } from 'react';
import type * as Y from 'yjs';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, smoothPath, splitPoints } from '../../shared/geometry/simplify';
import { screenToWorld, type Camera, type Point } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  /** The board camera: the preview is drawn in screen space, the stroke in world space. */
  camera: Camera;
  /** The pen this tab is holding; changing it does not touch the stroke being drawn. */
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  /** Recorded as the author of what is drawn here. */
  identityId: string;
  /**
   * This tab's undo history. One finished stroke is one step of its own, so the
   * capture window is closed around every commit — including the parts of a stroke
   * that hit the point limit (PRD undo.steps, pen.long_stroke).
   */
  undo?: UndoController;
}

/** One stroke in progress: points in both spaces, plus how far it has come. */
interface Drawing {
  pointerId: number;
  /** The pen at the moment the press began: a colour change mid-stroke is for later. */
  color: PenColor;
  thickness: PenThickness;
  /** World points, in the order they were recorded. */
  world: Point[];
  /** The same points in screen space, for the preview. */
  screen: Point[];
  /** Recorded points since the last part was committed (PRD pen.long_stroke). */
  raw: number;
  /** A frame is already queued: the preview is redrawn at most once per frame. */
  frame: number | null;
}

/**
 * The Pen tool's own surface (PRD pen.draw, pen.dot, pen.share, pen.navigation).
 *
 * It covers the board while the tool is active — as a layer *inside* the viewport, so
 * wheel and pinch keep navigating exactly as story 1 while a pointer drag belongs to
 * the pen, and so a drag that starts on top of a note draws over it instead of moving
 * it. Nothing here is ever written to the document until the stroke is finished: the
 * line being drawn is a local SVG path in screen space, and the only thing that
 * travels to other screens is the one `createStroke` transaction at the end
 * (PRD pen.share).
 */
export function PenTool({ camera, color, thickness, doc, identityId, undo }: PenToolProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  /** The in-progress line, in screen space, or null when the pen is not down. */
  const [previewD, setPreviewD] = useState<string | null>(null);
  const drawing = useRef<Drawing | null>(null);
  // Latest values for the listeners, which are attached once per gesture surface.
  const live = useRef({ camera, color, thickness, doc, identityId, undo });
  live.current = { camera, color, thickness, doc, identityId, undo };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const toScreen = (e: { clientX: number; clientY: number }): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const toWorld = (e: { clientX: number; clientY: number }): Point =>
      screenToWorld(live.current.camera, toScreen(e));

    /** Draw what has been recorded so far, once. */
    const redraw = (): void => {
      const d = drawing.current;
      setPreviewD(d ? smoothPath(d.screen) : null);
    };
    const schedule = (): void => {
      const d = drawing.current;
      if (!d || d.frame !== null) return;
      d.frame = requestAnimationFrame(() => {
        d.frame = null;
        redraw();
      });
    };

    /**
     * Turn what has been recorded into stroke objects (PRD pen.smooth).
     *
     * The simplification tolerance is the drawing budget divided by the zoom in use,
     * so a stroke drawn at 200% keeps twice the detail of one drawn at 100% and both
     * are one screen pixel away from the line that was drawn.
     */
    const commit = (d: Drawing): void => {
      const zoom = live.current.camera.zoom;
      const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / (zoom > 0 ? zoom : 1);
      const parts = splitPoints(simplify(d.world, tolerance));
      for (const part of parts) {
        if (part.length === 0) continue;
        live.current.undo?.boundary();
        // A rejected part (there is no such thing mid-draw, but the model decides)
        // simply does not appear; the preview is cleared either way.
        createStroke(
          live.current.doc,
          { points: part, color: d.color, thickness: d.thickness },
          live.current.identityId,
        );
        live.current.undo?.boundary();
      }
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0 || drawing.current !== null) return;
      e.preventDefault();
      const screen = toScreen(e);
      // One point to start with: a press that never moved draws a dot, because a
      // single point is exactly what the model turns into one (PRD pen.dot).
      drawing.current = {
        pointerId: e.pointerId,
        color: live.current.color,
        thickness: live.current.thickness,
        world: [toWorld(e)],
        screen: [screen],
        raw: 1,
        frame: null,
      };
      // The pointer is ours: a stroke keeps drawing when it wanders off the board.
      el.setPointerCapture?.(e.pointerId);
      moveCursor(e);
      redraw();
    };

    const onPointerMove = (e: PointerEvent): void => {
      const d = drawing.current;
      if (!d || d.pointerId !== e.pointerId) return;
      // One frame can hold several pointer samples; all of them are recorded, so a
      // fast hand draws every place it went (PRD pen.draw).
      const coalesced =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
      const samples = coalesced && coalesced.length > 0 ? coalesced : [e];
      for (const sample of samples) {
        const screen = toScreen(sample);
        d.world.push(toWorld(sample));
        d.screen.push(screen);
        d.raw += 1;
        if (d.raw >= STROKE_MAX_POINTS) {
          // The part in hand is full: commit it and carry on from its last point, so
          // the two strokes join with no gap (PRD pen.long_stroke).
          commit(d);
          const lastWorld = d.world[d.world.length - 1];
          const lastScreen = d.screen[d.screen.length - 1];
          d.world = [lastWorld];
          d.screen = [lastScreen];
          d.raw = 1;
        }
      }
      schedule();
    };

    /**
     * Release, cancel or a lost capture all finish the stroke (PRD pen.interrupted):
     * what was drawn so far is kept rather than thrown away.
     */
    const finish = (e: PointerEvent): void => {
      const d = drawing.current;
      if (!d || d.pointerId !== e.pointerId) return;
      // Claimed first, so a release and a lost-capture for the same pointer commit once.
      drawing.current = null;
      if (d.frame !== null) cancelAnimationFrame(d.frame);
      setPreviewD(null);
      el.releasePointerCapture?.(e.pointerId);
      commit(d);
    };

    const onPointerCancel = (e: PointerEvent): void => finish(e);
    const onLostPointerCapture = (e: PointerEvent): void => finish(e);

    /** The round cursor, sized like the ink, follows the pointer without a re-render. */
    function moveCursor(e: { clientX: number; clientY: number }): void {
      const dot = cursorRef.current;
      if (!dot) return;
      const p = toScreen(e);
      dot.style.transform = `translate(${p.x}px, ${p.y}px)`;
      dot.style.opacity = '1';
    }
    const onCursorMove = (e: PointerEvent): void => {
      if (drawing.current === null) moveCursor(e);
    };
    const onCursorLeave = (): void => {
      if (cursorRef.current) cursorRef.current.style.opacity = '0';
    };

    el.addEventListener('pointerdown', onPointerDown);
    // Move and release are tracked on the window, as everywhere else on this board,
    // so a pointer that wanders off the board still finishes the stroke.
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointermove', onCursorMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('lostpointercapture', onLostPointerCapture);
    el.addEventListener('pointerleave', onCursorLeave);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointermove', onCursorMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('lostpointercapture', onLostPointerCapture);
      el.removeEventListener('pointerleave', onCursorLeave);
      const d = drawing.current;
      if (d && d.frame !== null) cancelAnimationFrame(d.frame);
      // Leaving the tool throws the unfinished line away: it was never on the board.
      drawing.current = null;
    };
  }, []);

  const inkWorld = PEN_THICKNESS_WORLD[thickness];
  const inkScreen = Math.max(inkWorld * Math.max(camera.zoom, 0.05), 1);

  return (
    <div
      ref={rootRef}
      className="pen-tool-layer"
      data-testid="pen-tool"
      data-pen-color={color}
      data-pen-thickness={thickness}
      aria-label="Pen tool"
    >
      {previewD !== null ? (
        <PenPreview d={previewD} color={PEN_COLORS[color]} width={inkScreen} />
      ) : null}
      {/* A round cursor the size of the ink, so the next stroke is visible before it
          is drawn (PRD pen.options). */}
      <div
        ref={cursorRef}
        className="pen-cursor"
        data-testid="pen-cursor"
        aria-hidden="true"
        style={{
          width: `${inkScreen}px`,
          height: `${inkScreen}px`,
          background: PEN_COLORS[color],
          opacity: 0,
        }}
      />
    </div>
  );
}

/**
 * The line being drawn: a local overlay in screen space, so it stays one screen pixel
 * wide whatever the zoom, and is never part of the document (PRD pen.share).
 */
export function PenPreview({ d, color, width }: { d: string; color: string; width: number }): JSX.Element {
  return (
    <svg className="pen-preview-layer" data-testid="pen-preview-layer" aria-hidden="true">
      <path
        data-testid="pen-preview"
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
