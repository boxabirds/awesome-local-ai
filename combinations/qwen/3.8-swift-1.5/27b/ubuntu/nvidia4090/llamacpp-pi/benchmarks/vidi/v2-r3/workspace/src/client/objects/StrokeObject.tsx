import { useEffect, useRef, type ReactElement } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { localScaledPoints, scaledPoints, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';
import { distanceToPolyline } from '../../shared/geometry/polyline';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { Camera, Point } from '../canvas/camera';

export interface StrokeObjectProps {
  /** The stroke snapshot (design contract). */
  stroke?: StrokeSnap;
  /** Registry generic rendering passes the snapshot as `obj`. */
  obj?: ObjectSnapshot;
  selected: boolean;
  /** Interaction wiring (beyond the {stroke, selected} contract). */
  camera?: Camera;
  /** Pointerdown on the stroke's line: select (+ drag) the stroke. */
  onObjectPointerDown?: (e: PointerEvent, id: string) => void;
  /**
   * Pointerdown inside the stroke's bbox but off its line: the board routes
   * the event to the object underneath (or leaves it to the viewport).
   */
  onMissHit?: (e: PointerEvent, world: Point) => void;
}

/**
 * A freehand stroke (story 11, pen). Renders the stored points as a
 * smoothed SVG path scaled to the object's current size; the line thickness
 * is never scaled. Announced to assistive tech as "Drawing".
 *
 * Selection is by line distance (the registry hit test): a pointerdown on
 * the line selects the stroke; a pointerdown inside the bbox but away from
 * the line is routed to the object underneath (pen.select fall-through),
 * and with nothing underneath the event is left un-stopped so the viewport
 * keeps its normal pan/marquee/clear behaviour.
 */
export function StrokeObject({
  stroke,
  obj,
  selected,
  camera,
  onObjectPointerDown,
  onMissHit,
}: StrokeObjectProps): ReactElement {
  const s = (stroke ?? (obj as StrokeSnap | undefined)) as StrokeSnap | undefined;
  const containerRef = useRef<HTMLDivElement>(null);

  // Native listener (stable) reading the latest props from a ref.
  const stateRef = useRef({ camera, onObjectPointerDown, onMissHit, stroke: s });
  stateRef.current = { camera, onObjectPointerDown, onMissHit, stroke: s };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { camera: cam, onObjectPointerDown: oopd, onMissHit: omh, stroke: snap } = stateRef.current;
      if (!cam || !snap) return;
      // World point of the click: screen → world via the camera, measured
      // relative to the viewport's page origin (the board fills the window,
      // so the viewport rect is the right reference; in jsdom it is zero).
      const vp = (el.closest('[data-testid="board-viewport"]') ?? el) as HTMLElement;
      const rect = vp.getBoundingClientRect();
      const zoom = cam.zoom > 0 ? cam.zoom : 1;
      const world: Point = {
        x: (e.clientX - rect.left + cam.x) / zoom,
        y: (e.clientY - rect.top + cam.y) / zoom,
      };
      // Line-distance hit test (same expression as the registry entry).
      const onLine =
        distanceToPolyline(scaledPoints(snap), world) <=
        Math.max(PEN_THICKNESS_WORLD[snap.thickness] / 2, STROKE_HIT_TOLERANCE_PX / cam.zoom);
      if (onLine) {
        // On the line: select + drag the stroke (and don't pan).
        e.stopPropagation();
        oopd?.(e, snap.id);
      } else {
        // Inside the bbox but off the line: fall through to what's below.
        omh?.(e, world);
      }
    };
    el.addEventListener('pointerdown', onPointerDown);
    return () => el.removeEventListener('pointerdown', onPointerDown);
  }, []);

  // The SVG's local coordinate system starts at the object's bbox origin
  // (the div is positioned at (s.x, s.y)), so render local points.
  const d = s ? smoothPath(localScaledPoints(s)) : '';
  const strokeColor = PEN_COLORS[s?.color ?? 'black'];
  const sw = PEN_THICKNESS_WORLD[s?.thickness ?? 'medium'];

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Drawing"
      data-testid={`stroke-object-${s?.id ?? 'invalid'}`}
      data-selected={selected || undefined}
      data-color={s?.color}
      data-thickness={s?.thickness}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: s?.x ?? 0,
        top: s?.y ?? 0,
        width: s?.width ?? s?.baseWidth ?? 0,
        height: s?.height ?? s?.baseHeight ?? 0,
        zIndex: s?.z ?? 0,
        visibility: s ? 'visible' : 'hidden',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <svg
        width={s?.width ?? s?.baseWidth ?? 0}
        height={s?.height ?? s?.baseHeight ?? 0}
        style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
      >
        <path
          d={d}
          fill="none"
          stroke={strokeColor}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
