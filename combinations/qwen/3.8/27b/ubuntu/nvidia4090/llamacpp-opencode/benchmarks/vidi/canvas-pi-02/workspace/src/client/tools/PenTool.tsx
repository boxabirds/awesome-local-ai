/**
 * Pen tool (story 11, pen.tool).
 *
 * While the Pen tool is active, PenTool (mounted by the board page) captures
 * the pointer at the WINDOW CAPTURE phase, i.e. before any object or the
 * viewport can see the event. A press anywhere on the board (the viewport or
 * the selection overlay, including over notes, shapes, texts and other
 * strokes) therefore never pans, selects, moves or resizes: it draws.
 *
 *  - The press captures the pointer on the viewport element, so every
 *    subsequent move/up/cancel is delivered to it (and on) even if the
 *    pointer flies outside the board.
 *  - Raw points (world units, coalesced pointer events included) are
 *    collected per "part". A preview path — the current part, transformed to
 *    screen space with the live camera — is redrawn at most once per frame
 *    (rAF), in the current colour at the current thickness × zoom.
 *  - On release, the part is simplified (RDP at
 *    STROKE_SIMPLIFY_TOLERANCE_PX / zoom) and committed with createStroke —
 *    one update per release, one undo step per stroke (the caller's undo
 *    capture is stopped after each commit). A click without movement
 *    (distance < DRAG_THRESHOLD_PX) commits a single point: a round dot.
 *  - Reaching STROKE_MAX_POINTS commits the part and continues as a new
 *    stroke from the last point (pen.long_stroke).
 *  - A lost/aborted capture (lostpointercapture, pointercancel, unmount
 *    mid-drag) commits the points collected so far — interrupted strokes are
 *    kept, never discarded.
 *  - A double-click while the Pen is active is swallowed (no sticky note is
 *    created); the pen stays active after every commit (pen.stay_active).
 *
 * The round cursor preview follows the pointer (updated directly on the DOM
 * node, no re-render) and is hidden outside the board.
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import type { Camera, Point } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
} from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';

export interface PenToolProps {
  /** The live camera (preview transform + zoom-scaled tolerance). */
  camera: Camera;
  /** Current pen colour (usePenOptions). */
  color: PenColor;
  /** Current pen thickness (usePenOptions). */
  thickness: PenThickness;
  /** The board doc the strokes are committed to. */
  doc: Y.Doc;
  /** The identity id recorded as `createdBy` on committed strokes. */
  identityId: string;
  /**
   * The tab's undo controller (story 8): `boundary()` stops the undo
   * capture, so each committed stroke is exactly one undo step even when
   * strokes follow each other quickly.
   */
  undo?: { boundary(): void };
}

interface DrawingState {
  pointerId: number;
  /** The current part, world units (already coalesced). */
  points: Point[];
  /** The press position, screen pixels (dot threshold). */
  startClient: Point;
}

/** The full-window input surface the pen draws on. */
const VIEWPORT_SELECTOR = '.vidi6-viewport';
/** The screen-space selection chrome (handles, bar) is board surface too. */
const OVERLAY_SELECTOR = '.vidi6-selection-overlay';

export function PenTool({ camera, color, thickness, doc, identityId, undo }: PenToolProps): JSX.Element {
  // The preview is the only pen state that re-renders React; everything else
  // lives in refs so the (window-level) handlers stay stable across renders.
  const [preview, setPreview] = useState<Point[] | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const colorRef = useRef(color);
  colorRef.current = color;
  const thicknessRef = useRef(thickness);
  thicknessRef.current = thickness;
  const docRef = useRef(doc);
  docRef.current = doc;
  const identityRef = useRef(identityId);
  identityRef.current = identityId;
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const drawingRef = useRef<DrawingState | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const cursorRef = useRef<SVGCircleElement | null>(null);

  const boardElement = (selector: string): Element | null => document.querySelector(selector);

  const toScreen = (e: { clientX: number; clientY: number }): Point => {
    const rect = boardElement(VIEWPORT_SELECTOR)?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  const toWorld = (e: { clientX: number; clientY: number }): Point =>
    screenToWorld(cameraRef.current, toScreen(e));

  const onBoard = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    return target.closest(VIEWPORT_SELECTOR) !== null || target.closest(OVERLAY_SELECTOR) !== null;
  };

  /** Redraw the preview at most once per frame (rAF). */
  const schedulePreview = (): void => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const d = drawingRef.current;
      setPreview(d !== null ? [...d.points] : null);
    });
  };

  const cancelPreview = (): void => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  /** Simplify + commit one part; stops the undo capture so it is one step. */
  const commitPart = (points: Point[]): void => {
    if (points.length === 0) return;
    const tolerance = STROKE_SIMPLIFY_TOLERANCE_PX / cameraRef.current.zoom;
    const simplified = simplify(points, tolerance);
    const id = createStroke(
      docRef.current,
      { points: simplified, color: colorRef.current, thickness: thicknessRef.current },
      identityRef.current,
    );
    if (id !== null) undoRef.current?.boundary();
  };

  // Pointer release, guarded: capture may already be gone.
  const releasePointer = (d: DrawingState): void => {
    try {
      const vp = boardElement(VIEWPORT_SELECTOR);
      if (vp !== null && typeof vp.releasePointerCapture === 'function') {
        vp.releasePointerCapture(d.pointerId);
      }
    } catch {
      // capture may already be gone; the stroke ends either way
    }
  };

  /** Finish the current part. `up` = pointerup/pointercancel event (if any). */
  const finish = (up?: { pointerId?: number; clientX: number; clientY: number }): void => {
    const d = drawingRef.current;
    if (d === null) return;
    if (up !== undefined && up.pointerId !== undefined && up.pointerId !== d.pointerId) return;
    drawingRef.current = null;
    cancelPreview();
    releasePointer(d);
    // A click without movement commits a single point: a round dot (pen.dot).
    if (up !== undefined) {
      const dist = Math.hypot(up.clientX - d.startClient.x, up.clientY - d.startClient.y);
      if (dist < DRAG_THRESHOLD_PX) {
        setPreview(null);
        commitPart([d.points[0]!]);
        return;
      }
    }
    setPreview(null);
    commitPart(d.points);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (drawingRef.current !== null) return;
    if (!onBoard(e.target)) return;
    // Intercept BEFORE objects and the viewport: this press draws, it never
    // pans, selects or moves anything underneath.
    e.stopPropagation();
    e.preventDefault();
    try {
      (boardElement(VIEWPORT_SELECTOR) as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
    } catch {
      // capture unsupported (jsdom); the window listeners still see the moves
    }
    drawingRef.current = {
      pointerId: e.pointerId,
      points: [toWorld(e)],
      startClient: { x: e.clientX, y: e.clientY },
    };
    updateCursor(e);
    schedulePreview();
  };

  const onPointerMove = (e: PointerEvent): void => {
    updateCursor(e);
    const d = drawingRef.current;
    if (d === null || e.pointerId !== d.pointerId) return;
    const events: PointerEvent[] =
      typeof (e as PointerEvent).getCoalescedEvents === 'function'
        ? ((e as PointerEvent).getCoalescedEvents() as PointerEvent[])
        : [e];
    for (const ev of events) d.points.push(toWorld(ev));
    // pen.long_stroke: commit at STROKE_MAX_POINTS and continue as a new
    // stroke from the last point (the join point is shared).
    while (d.points.length >= STROKE_MAX_POINTS) {
      const part = d.points.slice(0, STROKE_MAX_POINTS);
      d.points = d.points.slice(STROKE_MAX_POINTS - 1);
      commitPart(part);
    }
    schedulePreview();
  };

  const onPointerUp = (e: PointerEvent): void => {
    finish(e);
  };

  const onPointerCancel = (e: PointerEvent): void => {
    finish(e);
  };

  const onLostCapture = (e: Event): void => {
    const lostId = (e as Event & { pointerId?: number }).pointerId;
    if (lostId !== undefined && drawingRef.current !== null && lostId !== drawingRef.current.pointerId) return;
    // Interrupted strokes are kept, never discarded (pen.interrupted).
    finish();
  };

  const onDoubleClick = (e: MouseEvent): void => {
    if (onBoard(e.target)) {
      // No sticky-note creation while the Pen is active.
      e.stopPropagation();
      e.preventDefault();
    }
  };

  /** Move the round cursor preview (direct DOM update — no re-render). */
  const updateCursor = (e: { clientX: number; clientY: number; target: EventTarget | null }): void => {
    const c = cursorRef.current;
    if (c === null) return;
    if (!onBoard(e.target)) {
      c.style.display = 'none';
      return;
    }
    const s = toScreen(e);
    c.style.display = '';
    c.setAttribute('cx', String(s.x));
    c.setAttribute('cy', String(s.y));
  };

  useEffect(() => {
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('dblclick', onDoubleClick, true);
    const vp = boardElement(VIEWPORT_SELECTOR);
    vp?.addEventListener('lostpointercapture', onLostCapture);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('dblclick', onDoubleClick, true);
      vp?.removeEventListener('lostpointercapture', onLostCapture);
      cancelPreview();
      // Unmounted mid-drag: keep the stroke collected so far.
      const d = drawingRef.current;
      if (d !== null) {
        drawingRef.current = null;
        releasePointer(d);
        commitPart(d.points);
      }
    };
    // The handlers are recreated every render but intentionally (re)attached
    // only once: they read everything through refs, so a stable attachment
    // is correct and cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const thicknessWorld = PEN_THICKNESS_WORLD[thickness];
  const cursorRadius = Math.max(1.5, (thicknessWorld * camera.zoom) / 2);
  const previewScreen: Point[] = (preview ?? []).map((p) => worldToScreen(camera, p));
  const previewD = smoothPath(previewScreen);

  return (
    <svg
      className="vidi6-pen-overlay"
      data-testid="pen-overlay"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 4,
      }}
    >
      {preview !== null && preview.length > 0 && (
        <path
          data-testid="pen-preview"
          d={previewD}
          fill="none"
          stroke={PEN_COLORS[color]}
          strokeWidth={thicknessWorld * camera.zoom}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {/* Round cursor preview: sized to the thickness at the current zoom. */}
      <circle
        ref={cursorRef}
        data-testid="pen-cursor"
        r={cursorRadius}
        fill="none"
        stroke="#1f242c"
        strokeWidth={1}
        style={{ display: 'none' }}
      />
    </svg>
  );
}
