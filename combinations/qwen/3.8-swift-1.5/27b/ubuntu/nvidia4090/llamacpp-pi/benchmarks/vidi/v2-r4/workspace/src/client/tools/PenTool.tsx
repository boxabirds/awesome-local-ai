import { useRef, useEffect, useReducer, type JSX } from 'react';
import type { Camera } from '../canvas/camera';
import { screenToWorld, worldToScreen } from '../canvas/camera';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';
import { createStroke } from '../../shared/objects/stroke';
import { simplify, splitPoints, smoothPath } from '../../shared/geometry/simplify';
import {
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  DRAG_THRESHOLD_PX,
  PEN_THICKNESS_WORLD,
  PEN_COLORS,
} from '../../shared/config';
import type { Point } from '../../shared/geometry';
import type * as Y from 'yjs';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  /** Called after each committed stroke part (undo boundary, story 8). */
  onGestureEnd?(): void;
}

/**
 * Pen tool: freehand drawing (pen.draw).
 *
 * - pointerdown (captured, so drags over objects never pan or move them)
 *   starts a stroke; every pointermove appends world points, including
 *   coalesced events, and the local screen-space preview is redrawn once per
 *   animation frame.
 * - The preview is never written to the document: others only see a stroke
 *   once it is finished (pen.share).
 * - pointerup: movement below DRAG_THRESHOLD_PX commits a round dot,
 *   otherwise the points are simplified at STROKE_SIMPLIFY_TOLERANCE_PX /
 *   zoom and committed (pen.dot, pen.smooth).
 * - pointercancel / lostpointercapture: the points drawn so far are kept
 *   (pen.interrupted).
 * - At STROKE_MAX_POINTS the part is committed and drawing continues from the
 *   shared join point (pen.long_stroke).
 * - A rejected stroke (null) clears the preview silently.
 * - The tool stays active after each commit (pen.stay_active).
 */
export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness, doc, identityId, onGestureEnd } = props;
  const overlayRef = useRef<HTMLDivElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const downScreenRef = useRef<Point | null>(null);
  const lastPointerRef = useRef<Point | null>(null);
  const rafRef = useRef(0);
  const [, forceRender] = useReducer((c: number) => c + 1, 0);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const toScreen = (e: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const commit = (pts: Point[]): void => {
      const id = createStroke(doc, { points: pts, color, thickness }, identityId);
      // null → discard silently; the preview is cleared by the caller.
      if (id) onGestureEnd?.();
    };

    const finish = (): void => {
      const pts = pointsRef.current;
      pointsRef.current = [];
      forceRender();
      if (pts.length === 0) return;
      if (pts.length === 1) {
        commit(pts);
        return;
      }
      commit(simplify(pts, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom));
    };

    const schedulePreview = (): void => {
      if (rafRef.current !== 0) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        forceRender();
      });
    };

    const pd = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-testid="toolbar"]')) return;
      if (target.closest('[data-testid="selection-bar"]')) return;
      if (target.closest('[data-testid="pen-toolbar"]')) return;
      if (target.closest('[data-testid^="handle-"]')) return;

      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const sp = toScreen(e);
      downScreenRef.current = sp;
      lastPointerRef.current = sp;
      pointsRef.current = [screenToWorld(camera, sp)];
      forceRender();
    };

    const pm = (e: PointerEvent) => {
      if (!downScreenRef.current) return;
      lastPointerRef.current = toScreen(e);
      // Coalesced events give a faithful, smooth stroke at high input rates.
      const events: PointerEvent[] =
        typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events.length > 0 ? events : [e]) {
        pointsRef.current.push(screenToWorld(camera, toScreen(ev)));
      }

      // Very long strokes: commit finished parts, continue at the join point.
      if (pointsRef.current.length >= STROKE_MAX_POINTS) {
        const parts = splitPoints(pointsRef.current);
        for (const part of parts.slice(0, -1)) {
          commit(simplify(part, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom));
        }
        pointsRef.current = parts[parts.length - 1];
      }

      schedulePreview();
    };

    const pu = (e: PointerEvent) => {
      if (!downScreenRef.current) return;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      const sp = toScreen(e);
      const down = downScreenRef.current;
      downScreenRef.current = null;
      // A click without movement draws a round dot at the press point.
      if (Math.hypot(sp.x - down.x, sp.y - down.y) < DRAG_THRESHOLD_PX) {
        pointsRef.current = [screenToWorld(camera, down)];
      }
      finish();
    };

    // Interrupted drag (pointercancel or lost capture): keep the points so far.
    const pc = () => {
      if (!downScreenRef.current) return;
      downScreenRef.current = null;
      finish();
    };

    el.addEventListener('pointerdown', pd, { capture: true });
    el.addEventListener('pointermove', pm);
    el.addEventListener('pointerup', pu);
    el.addEventListener('pointercancel', pc);
    el.addEventListener('lostpointercapture', pc);
    return () => {
      el.removeEventListener('pointerdown', pd, { capture: true });
      el.removeEventListener('pointermove', pm);
      el.removeEventListener('pointerup', pu);
      el.removeEventListener('pointercancel', pc);
      el.removeEventListener('lostpointercapture', pc);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [camera, doc, color, thickness, identityId, onGestureEnd]);

  const points = pointsRef.current;
  const previewD =
    points.length > 0 ? smoothPath(points.map((p) => worldToScreen(camera, p))) : '';
  const cursorSize = PEN_THICKNESS_WORLD[thickness] * camera.zoom;
  const cursor = lastPointerRef.current;

  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        cursor: 'none',
      }}
    >
      {previewD && (
        <svg
          data-testid="pen-preview"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          <path
            data-testid="pen-preview-path"
            d={previewD}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={PEN_THICKNESS_WORLD[thickness] * camera.zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor && (
        <div
          data-testid="pen-cursor"
          style={{
            position: 'absolute',
            left: cursor.x - cursorSize / 2,
            top: cursor.y - cursorSize / 2,
            width: cursorSize,
            height: cursorSize,
            borderRadius: '50%',
            border: `1px solid ${PEN_COLORS[color]}`,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}
