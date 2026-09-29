// A finished freehand stroke (story 11 `pen.select`).
//
// It renders inside the world layer like every other object, so its box is in board units
// and the layer's `scale(zoom)` is what scales the drawing. The line itself is one SVG
// path through `scaledPoints` — the points as the object's *current* box has them, which is
// how a proportional resize stretches a sketch without a single write to the points
// (pen.resize) — with round caps so a stroke reads as a drawn line and a one-point stroke
// reads as a dot (pen.dot).
//
// Two paths are drawn on top of each other: a transparent one as wide as a click may be
// (twice the larger of half the thickness and the click tolerance in board units) that
// takes the pointer, and the visible stroke. That is what makes a stroke selectable by its
// line and not by its box: the SVG root takes no pointer at all, so a click inside a large
// scribble's box but away from its line falls through to the note underneath.
//
// The component is given the generic `ObjectProps` the board hands every object, so
// selection, moving, resize handles, delete and undo come from the board for nothing. The
// optional `stroke` prop is a convenience for a test that has a stroke snapshot to hand.

import {
  asStrokeSnapshot,
  penPaint,
  penThickness,
  scaledPoints,
  type StrokeSnap,
} from '../../shared/objects/stroke.ts';
import { smoothPath } from '../../shared/geometry/simplify.ts';
import {
  DEFAULT_PEN_COLOR,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config.ts';
import type { ObjectProps } from './registry.tsx';

export interface StrokeObjectProps extends ObjectProps {
  /** The stroke to draw; by default the `obj` the board was given. */
  stroke?: StrokeSnap;
}

/** How wide the invisible selectable line is, in board units. */
export function strokeHitWidthWorld(thicknessWorld: number, zoom: number): number {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return 2 * Math.max(thicknessWorld / 2, STROKE_HIT_TOLERANCE_PX / z);
}

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * One drawn stroke: its line, its invisible selectable line, and the bbox outline that
 * says it is selected.
 */
export function StrokeObject(props: StrokeObjectProps) {
  const stroke = props.stroke ?? asStrokeSnapshot(props.obj);
  const points = scaledPoints(stroke);
  const d = smoothPath(points);
  const zoom = Number.isFinite(props.zoom) && props.zoom > 0 ? props.zoom : 1;
  const thicknessWorld = penThickness(stroke.thickness);
  const paint = penPaint(stroke.color) ?? penPaint(DEFAULT_PEN_COLOR)!;
  const selected = props.selected;
  const onPointerDown = (e: React.PointerEvent<SVGElement>) => {
    props.onObjectPointerDown(e as unknown as React.PointerEvent<HTMLElement>, stroke.id);
  };
  const onDoubleClick = (e: React.MouseEvent<SVGElement>) => {
    props.onObjectDoubleClick(e as unknown as React.MouseEvent<HTMLElement>, stroke.id);
  };
  return (
    <svg
      data-testid="stroke-object"
      data-stroke-id={stroke.id}
      data-stroke-color={stroke.color}
      data-stroke-thickness={stroke.thickness}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      // A drawing on the board is announced as a drawing, not as its points.
      aria-label={`Drawing (${label(stroke.color)}, ${label(stroke.thickness)})`}
      tabIndex={0}
      // Firefox starts a native drag as soon as the pointer is pressed on an SVG element,
      // and the pointer of a drag that is stolen that way is cancelled — the stroke would
      // never move under the hand. A drawing on a board is not a thing you carry away.
      onDragStart={(e) => e.preventDefault()}
      viewBox={`${stroke.x} ${stroke.y} ${stroke.width} ${stroke.height}`}
      style={{
        position: 'absolute',
        left: stroke.x,
        top: stroke.y,
        width: stroke.width,
        height: stroke.height,
        overflow: 'visible',
        // Only the wide transparent line below takes the pointer.
        pointerEvents: 'none',
        userSelect: 'none',
        outline: selected ? '2px solid #2f6fed' : 'none',
        outlineOffset: 2,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      {d === '' ? null : (
        <>
          <path
            data-testid="stroke-hit-area"
            d={d}
            fill="none"
            stroke="transparent"
            strokeWidth={strokeHitWidthWorld(thicknessWorld, zoom)}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ pointerEvents: 'stroke', cursor: 'move' }}
          />
          <path
            data-testid="stroke-path"
            d={d}
            fill="none"
            stroke={paint}
            strokeWidth={thicknessWorld}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {selected ? (
            <path
              data-testid="stroke-selection"
              d={d}
              fill="none"
              stroke="#2f6fed"
              strokeWidth={Math.max(1, thicknessWorld / 3)}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="6 5"
              opacity={0.9}
            />
          ) : null}
        </>
      )}
    </svg>
  );
}

// `objects/registry.tsx` registers this component as the 'stroke' type.
export default StrokeObject;
