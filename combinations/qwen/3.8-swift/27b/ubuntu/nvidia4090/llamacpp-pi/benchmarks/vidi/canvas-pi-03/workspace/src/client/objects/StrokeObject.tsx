/**
 * Story 11: the stroke board object (pen.draw rendering, pen.select).
 *
 * Renders the simplified points as a smooth SVG `path`
 * (`d = smoothPath(scaledPoints)`, relative to the bbox origin) with
 * `stroke-linecap/linejoin: round`, `stroke-width` = the stored thickness in
 * world units (the world layer scales it at any zoom — the thickness is NOT
 * scaled by resizing), the PEN_COLORS colour and `fill: none`.
 *
 * Interaction (all from the generic story 7 machinery):
 * - the WIDE invisible hit path (STROKE_HIT_TOLERANCE_PX, constant in screen
 *   px at any zoom) carries the press → the generic gesture selects/moves it;
 *   the board additionally hit-tests the polyline in world units for the
 *   empty-click path and jsdom component tests (pen.select);
 * - the div covering the bbox is pointer-transparent, so a click in empty
 *   space inside the bounds reaches the objects below (pen.select);
 * - move, aspect-locked resize, nudge and delete come from the registry
 *   spec (resizable + aspectLocked + minSize STROKE_MIN_SIZE_WORLD).
 *
 * Accessibility: announced as "Drawing" (pen.aria).
 */
import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from 'src/shared/config';
import { smoothPath } from 'src/shared/geometry/simplify';
import { getStroke, scaledPoints, type StrokeSnap } from 'src/shared/objects/stroke';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '#1A73E8';

/**
 * d-string cache keyed by (id, geometry): the path is a pure function of the
 * bbox + stored points, which change only on creation/resize. Long strokes
 * (5,000 points) would otherwise rebuild a huge string on every unrelated
 * re-render (e.g. the pen cursor tracking during a long-stroke drag).
 */
const pathCache = new Map<string, string>();
function cachedD(key: string, build: () => string): string {
  const hit = pathCache.get(key);
  if (hit !== undefined) return hit;
  if (pathCache.size > 200) pathCache.clear();
  const d = build();
  pathCache.set(key, d);
  return d;
}

/** The full stroke snapshot for a registered object (malformed → undefined). */
function strokeOf(props: ObjectProps): StrokeSnap | undefined {
  return getStroke(props.doc, props.obj.id);
}

export function StrokeObject(props: ObjectProps): JSX.Element {
  const { obj, selected, zoom } = props;
  const stroke = strokeOf(props);
  if (!stroke) {
    // Malformed stroke: nothing to draw (the hit test also rejects it).
    return <div data-testid="stroke-object" data-note-id={obj.id} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }} />;
  }

  const width = stroke.width ?? stroke.baseWidth;
  const height = stroke.height ?? stroke.baseHeight;
  // Path coordinates relative to the bbox origin (the div is at x, y).
  const d = cachedD(
    `${stroke.id}:${stroke.x}:${stroke.y}:${stroke.width}:${stroke.height}`,
    () => {
      const local = scaledPoints(stroke).map((p) => ({ x: p.x - stroke.x, y: p.y - stroke.y }));
      return smoothPath(local);
    },
  );
  const color = PEN_COLORS[stroke.color];
  const thickness = PEN_THICKNESS_WORLD[stroke.thickness];
  const z = Math.max(zoom, 0.01);
  // Screen-constant hit tolerance in world units (the visible width is the
  // floor, so a thick pen is never harder to click than it looks).
  const hitWidth = Math.max(thickness, (STROKE_HIT_TOLERANCE_PX * 2) / z);

  const handlePointerDown = (e: React.PointerEvent<SVGPathElement>) => {
    if (e.button !== 0) return;
    // The board must not pan while a stroke is pressed.
    e.stopPropagation();
    // Selection and move are the generic gesture's job (story 7).
    props.onPointerDown(e as unknown as React.PointerEvent<HTMLElement>, obj.id);
  };

  return (
    <div
      data-testid="stroke-object"
      data-note-id={obj.id}
      data-selected={selected || undefined}
      role="img"
      aria-label="Drawing"
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width,
        height,
        outline: selected ? `2px solid ${SELECTION_OUTLINE}` : 'none',
        outlineOffset: 0,
        cursor: 'move',
        zIndex: obj.z,
        touchAction: 'none',
        pointerEvents: 'none', // the bbox itself never intercepts (pen.select)
      }}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
        aria-hidden="true"
      >
        {/* Wide invisible hit path (screen-constant tolerance). */}
        <path
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'stroke' }}
          onPointerDown={handlePointerDown}
        />
        {/* The visible line (pen.draw). */}
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
