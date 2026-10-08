// PenTool (story 11, pen.tool): the Pen tool's pointer gesture.
//
//  - A press inside the viewport starts a stroke (capture phase, so a press
//    that begins over an existing object never moves that object and never
//    pans the board — pen.navigation); the pointer is captured so the drag
//    finishes no matter where it ends.
//  - Every pointer move appends its world point (plus the browser's
//    coalesced events, when available) and the local screen-space preview
//    path is redrawn once per animation frame. The preview is never written
//    to the document, so nobody else sees an in-progress stroke (pen.share).
//  - A press and release with movement below DRAG_THRESHOLD_PX commits a
//    single point: a round dot whose diameter is the chosen thickness
//    (pen.dot).
//  - At STROKE_MAX_POINTS recorded points the current part is simplified and
//    committed and drawing continues as a new stroke from the same last
//    point, so the two join with no visible gap (pen.long_stroke).
//  - pointerup simplifies the points at STROKE_SIMPLIFY_TOLERANCE_PX / zoom
//    (within 1 screen pixel of the drawn path, pen.smooth) and commits one
//    stroke; pointercancel / lostpointercapture commit the points drawn so
//    far instead of discarding them (pen.interrupted).
//  - After every commit the per-board undo controller stops capturing
//    (undo.boundaries) and the tool STAYS pen (pen.stay_active); Escape or
//    another tool unmounts the component, dropping an unfinished drag
//    without creating anything.

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath, simplify } from '../../shared/geometry/simplify';
import { createStroke, type PenColor, type PenThickness } from '../../shared/objects/stroke';
import type { Point } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import type { UndoController } from '../board/undo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  /** The creator id recorded on committed strokes (the client id). */
  identityId: string;
  /** Story 4 edit lock: a locked board never draws. */
  canEdit: boolean;
  /** Story 8: the per-board undo controller (one commit = one undo step). */
  undo?: UndoController;
}

interface DragState {
  pointerId: number;
  /** The recorded world points (starting with the press point). */
  points: Point[];
  startClientX: number;
  startClientY: number;
}

interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function viewportRect(): ViewportRect {
  const v = document.querySelector('[data-testid="board-viewport"]');
  const r = v ? v.getBoundingClientRect() : null;
  return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : { left: 0, top: 0, width: 0, height: 0 };
}

export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness, canEdit } = props;
  const stateRef = useRef(props);
  stateRef.current = props;

  const dragRef = useRef<DragState | null>(null);
  // The preview's world points (re-rendered at most once per frame).
  const [previewPts, setPreviewPts] = useState<Point[] | null>(null);
  const rafRef = useRef(0);
  // The round cursor (pen.cursor) is positioned via direct DOM writes so a
  // pointer move never re-renders the tool.
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = () => stateRef.current;

    const toWorld = (clientX: number, clientY: number): Point => {
      const b = viewportRect();
      return screenToWorld(s().camera, { x: clientX - b.left, y: clientY - b.top });
    };

    const inViewport = (t: EventTarget | null): boolean =>
      t instanceof Element && t.closest('[data-testid="board-viewport"]') !== null;

    const moveInsideViewport = (clientX: number, clientY: number): boolean => {
      const b = viewportRect();
      return (
        clientX >= b.left &&
        clientX <= b.left + b.width &&
        clientY >= b.top &&
        clientY <= b.top + b.height
      );
    };

    const updateCursor = (clientX: number, clientY: number): void => {
      const el = cursorRef.current;
      if (el === null) return;
      if (!moveInsideViewport(clientX, clientY)) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.left = `${clientX}px`;
      el.style.top = `${clientY}px`;
    };

    const schedulePreview = (): void => {
      if (rafRef.current !== 0) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const d = dragRef.current;
        if (d !== null) setPreviewPts([...d.points]);
      });
    };

    /** Commit one finished stroke (or part) as one undo step (pen.draw). */
    const commit = (pts: Point[]): void => {
      const st = s();
      const simplified =
        pts.length <= 2 ? pts : simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / st.camera.zoom);
      st.undo?.boundary();
      // A rejected stroke (should not happen: points are finite by
      // construction) clears the preview silently.
      createStroke(st.doc, { points: simplified, color: st.color, thickness: st.thickness }, st.identityId);
      st.undo?.boundary();
    };

    /** When the drawn part reaches STROKE_MAX_POINTS recorded points, commit
     *  it and continue as a new stroke from its last point (pen.long_stroke). */
    const enforceLimit = (d: DragState): void => {
      while (d.points.length >= STROKE_MAX_POINTS) {
        const part = d.points.slice(0, STROKE_MAX_POINTS);
        const last = part[part.length - 1]!;
        const rest = d.points.slice(STROKE_MAX_POINTS);
        commit(part);
        d.points = [last, ...rest];
      }
    };

    const onPointerDown = (e: PointerEvent): void => {
      const st = s();
      if (!st.canEdit) return;
      if (dragRef.current !== null) return; // one stroke at a time
      if (!inViewport(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.target instanceof Element && typeof e.target.setPointerCapture === 'function') {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {
          // Ignore: best-effort (jsdom).
        }
      }
      const p = toWorld(e.clientX, e.clientY);
      dragRef.current = {
        pointerId: e.pointerId,
        points: [p],
        startClientX: e.clientX,
        startClientY: e.clientY,
      };
      setPreviewPts([p]); // the preview exists from the very first frame
    };

    const onPointerMove = (e: PointerEvent): void => {
      updateCursor(e.clientX, e.clientY);
      const d = dragRef.current;
      if (d === null || e.pointerId !== d.pointerId) return;
      // Append every coalesced event the browser recorded (the list includes
      // the current event); fall back to the current event alone.
      const coalesced =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const evs = coalesced.length > 0 ? coalesced : [e];
      for (const c of evs) d.points.push(toWorld(c.clientX, c.clientY));
      enforceLimit(d);
      schedulePreview();
    };

    const finish = (d: DragState, asDot: boolean): void => {
      commit(asDot ? [d.points[0]!] : d.points);
    };

    const onPointerUp = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setPreviewPts(null);
      // A press and release with movement below the threshold is a dot
      // (pen.dot); anything else is a simplified stroke (pen.draw).
      const moved = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      finish(d, moved < DRAG_THRESHOLD_PX);
    };

    // pointercancel / lostpointercapture before release keep the points drawn
    // so far (pen.interrupted) — a single bare press becomes a dot.
    const onCancel = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setPreviewPts(null);
      finish(d, d.points.length === 1);
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', onCancel, { capture: true });
    window.addEventListener('lostpointercapture', onCancel, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onCancel, { capture: true });
      window.removeEventListener('lostpointercapture', onCancel, { capture: true });
      if (rafRef.current !== 0) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const cursorSize = Math.max(1, thicknessWorld * camera.zoom);

  return (
    <>
      {previewPts !== null && previewPts.length > 0 && (
        <svg
          data-testid="pen-preview-overlay"
          width="100%"
          height="100%"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 10000,
          }}
          aria-hidden="true"
        >
          {/* Local-only preview: never written to the document (pen.share). */}
          <path
            data-testid="pen-preview"
            d={smoothPath(previewPts.map((p) => worldToScreen(camera, p)))}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={thicknessWorld * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {/* The round cursor of the current thickness × zoom (pen.cursor). */}
      <div
        ref={cursorRef}
        className="pen-cursor"
        data-testid="pen-cursor"
        aria-hidden="true"
        style={{ display: 'none', width: cursorSize, height: cursorSize }}
      />
    </>
  );
}
