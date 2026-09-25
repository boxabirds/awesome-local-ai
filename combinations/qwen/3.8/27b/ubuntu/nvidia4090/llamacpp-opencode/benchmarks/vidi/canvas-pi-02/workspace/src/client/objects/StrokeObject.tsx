/**
 * Stroke renderer (story 11, stroke.render).
 *
 * A stroke is one SVG path in an absolute-positioned container sized to the
 * stroke's bbox:
 *  - an invisible wide HIT path (pointer-events: stroke) whose width is the
 *    pen line's thickness widened to at least STROKE_HIT_TOLERANCE_PX screen
 *    pixels at the current zoom — clicking or dragging the line selects and
 *    moves the stroke, while a click inside the bbox but off the line falls
 *    through to whatever is below (pen.select);
 *  - the visible smoothed path in the pen colour at the pen thickness
 *    (world units — the world layer scales it with the board zoom), round
 *    caps and joins. A single-point stroke is a zero-length round-capped
 *    path, i.e. a round dot (pen.dot).
 *
 * The container itself is click-through (pointer-events: none). Selection
 * chrome (box + handles) comes from the shared SelectionOverlay (story 7),
 * so moving/resizing/deleting uses the exact shared behaviour, with the
 * geometry rescaled proportionally on aspect-locked resize and the thickness
 * staying constant (pen.resize).
 */

import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';
import { scaledPoints, strokeHitTolerance, type StrokeSnap } from '../../shared/objects/stroke';
import { smoothPath } from '../../shared/geometry/simplify';

export interface StrokeObjectProps {
  /** The stroke snapshot (generic object fields + points / base size / thickness). */
  stroke: StrokeSnap;
  /** Whether this stroke is in the current selection. */
  selected: boolean;
  /** The current camera zoom (screen px per world unit) for the hit width. */
  zoom: number;
  /** Generic object press (story 7 transform gesture; window-level). */
  onObjectPointerDown?: (e: PointerEvent, id: string) => void;
  /** Click selects the stroke. */
  onSelect?: (id: string) => void;
}

// The selection chrome (box + handles) is drawn by the shared Selection
// Overlay (story 7), so `selected` is part of the contract but unused here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function StrokeObject({ stroke, zoom, onObjectPointerDown, onSelect }: StrokeObjectProps): JSX.Element | null {
  const points = stroke.points;
  if (points === undefined || points.length === 0) return null;

  const w = stroke.width ?? 1;
  const h = stroke.height ?? 1;
  const thickness = PEN_THICKNESS_WORLD[(stroke.thickness ?? 'medium') as PenThickness] ?? PEN_THICKNESS_WORLD.medium;
  const color = PEN_COLORS[(stroke.color ?? 'black') as PenColor] ?? PEN_COLORS.black;
  const d = smoothPath(scaledPoints(stroke));
  // Hit radius in world units: half the pen line, or 6 screen px at this zoom
  // (whichever is larger); the hit path's stroke width is twice that radius.
  const hitWidth = 2 * strokeHitTolerance(stroke, zoom);

  return (
    <div
      data-testid="stroke-object"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: w,
        height: h,
        pointerEvents: 'none',
      }}
    >
      <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }} aria-hidden={true}>
        {/* Invisible wide hit path: the only interactive part of the stroke. */}
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke', cursor: 'grab' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onObjectPointerDown?.(e.nativeEvent, stroke.id);
          }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.(stroke.id);
          }}
        />
        {/* Visible pen stroke. */}
        <path
          data-testid="stroke-path"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
      </svg>
    </div>
  );
}
