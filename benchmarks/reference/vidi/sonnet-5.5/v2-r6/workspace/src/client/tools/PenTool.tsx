import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX, PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_MAX_POINTS, STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor, type PenThickness,
} from '../../shared/config';
import { simplify } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { useUndoController } from '../board/useUndo';
import { screenToWorld, worldToScreen, type Camera, type Point } from '../canvas/camera';
import { localPoint, viewportOf } from './toolLayer';

const PRIMARY_BUTTON = 0;
const HALF = 2;

interface Drawing {
  points: Point[];
  /** Screen position of the press, to tell a click (dot) from a drag. */
  origin: Point;
  moved: boolean;
  /** True once the stroke was split: the part being drawn started at the previous part's last point. */
  continued: boolean;
}

/**
 * The Pen tool. A drag records world points into a local preview that is never written to the document;
 * release, cancel, lost capture or reaching STROKE_MAX_POINTS commits simplified stroke objects.
 */
export function PenTool(props: { camera: Camera; color: PenColor; thickness: PenThickness; doc: Y.Doc; identityId: string }) {
  const layer = useRef<HTMLDivElement>(null);
  const undo = useUndoController();
  const latest = useRef({ ...props, undo });
  latest.current = { ...props, undo };
  const [preview, setPreview] = useState<string | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportOf(layer.current);
    if (!viewport) return undefined;
    let drawing: Drawing | null = null;
    let frame: number | null = null;

    const previewPath = (): string => {
      if (!drawing) return '';
      const cam = latest.current.camera;
      return drawing.points.map((p, i) => {
        const s = worldToScreen(cam, p);
        return `${i === 0 ? 'M' : 'L'}${s.x} ${s.y}`;
      }).join('');
    };
    const flush = () => {
      frame = null;
      setPreview(drawing ? previewPath() : null);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(flush);
    };

    const commit = (part: Drawing) => {
      const { camera, color, thickness, doc, identityId, undo: u } = latest.current;
      if (part.points.length === 1 && part.continued) return; // a split that ended exactly at the join
      const isDot = !part.continued && !part.moved;
      const pts = isDot ? [part.points[0]] : simplify(part.points, STROKE_SIMPLIFY_TOLERANCE_PX / camera.zoom);
      u?.boundary();
      createStroke(doc, { points: pts, color, thickness }, identityId);
      u?.boundary();
    };

    const finish = () => {
      const d = drawing;
      drawing = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('keydown', onKey, true);
      viewport.removeEventListener('lostpointercapture', finish);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      setPreview(null);
      if (d) commit(d);
    };

    const append = (e: PointerEvent) => {
      const d = drawing;
      if (!d) return;
      const cam = latest.current.camera;
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of events.length > 0 ? events : [e]) {
        const screen = localPoint(viewport, ev);
        if (Math.hypot(screen.x - d.origin.x, screen.y - d.origin.y) >= DRAG_THRESHOLD_PX) d.moved = true;
        d.points.push(screenToWorld(cam, screen));
        if (d.points.length >= STROKE_MAX_POINTS) {
          commit(d);
          const last = d.points[d.points.length - 1];
          d.points = [last];
          d.continued = true;
          d.moved = true;
        }
      }
    };
    const onMove = (e: PointerEvent) => {
      append(e);
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      if (drawing && e.clientX !== undefined) append(e);
      finish();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== PRIMARY_BUTTON) return;
      e.stopPropagation();
      e.preventDefault();
      if (drawing) return;
      const screen = localPoint(viewport, e);
      drawing = { points: [screenToWorld(latest.current.camera, screen)], origin: screen, moved: false, continued: false };
      try {
        viewport.setPointerCapture?.(e.pointerId);
      } catch {
        // capture can fail for synthetic or already-ended pointers; window listeners still follow the drag
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', finish);
      window.addEventListener('keydown', onKey, true);
      viewport.addEventListener('lostpointercapture', finish);
      schedule();
    };
    // The round cursor follows the pointer through the DOM directly: no re-render per move.
    const onHover = (e: PointerEvent) => {
      const el = cursorRef.current;
      if (!el) return;
      const p = localPoint(viewport, e);
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      el.style.display = 'block';
    };
    const onLeave = () => {
      if (cursorRef.current) cursorRef.current.style.display = 'none';
    };

    viewport.addEventListener('pointerdown', onDown, true);
    viewport.addEventListener('pointermove', onHover);
    viewport.addEventListener('pointerleave', onLeave);
    return () => {
      viewport.removeEventListener('pointerdown', onDown, true);
      viewport.removeEventListener('pointermove', onHover);
      viewport.removeEventListener('pointerleave', onLeave);
      if (drawing) finish();
    };
  }, []);

  const size = Math.max(HALF, PEN_THICKNESS_WORLD[props.thickness] * props.camera.zoom);
  return (
    <div ref={layer} className="tool-layer" data-testid="pen-tool">
      {preview !== null && (
        <svg className="pen-preview" aria-hidden="true">
          <path
            data-testid="pen-preview"
            d={preview}
            fill="none" stroke={PEN_COLORS[props.color]} strokeLinecap="round" strokeLinejoin="round"
            strokeWidth={PEN_THICKNESS_WORLD[props.thickness] * props.camera.zoom}
          />
        </svg>
      )}
      <div ref={cursorRef} className="pen-cursor" data-testid="pen-cursor" style={{ width: size, height: size, display: 'none' }} />
    </div>
  );
}
