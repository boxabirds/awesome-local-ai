import type { CSSProperties } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { type StrokeSnap, scaledPoints } from '../../shared/objects/stroke';
import type { ObjectProps } from './registry';

/**
 * A pen stroke (story 11): a smooth line with round ends and joins, scaled to the stroke's
 * current box while its line width stays the stored thickness. The stroke takes no pointer
 * events: the board picks it by distance to its line, so a press on empty space inside its box
 * reaches whatever is underneath. Selecting, moving, resizing and deleting are generic (story 7).
 */
export function StrokeObject(
  props: { stroke: StrokeSnap; selected: boolean } & Partial<Omit<ObjectProps, 'object' | 'selected'>>,
) {
  const { stroke, selected } = props;
  const pts = scaledPoints(stroke).map((p) => ({ x: p.x - stroke.x, y: p.y - stroke.y }));
  const width = PEN_THICKNESS_WORLD[stroke.thickness];
  const style = {
    left: stroke.x,
    top: stroke.y,
    width: stroke.width,
    height: stroke.height,
    zIndex: props.layer,
  } as CSSProperties;
  return (
    <div
      className={selected ? 'stroke-object is-selected' : 'stroke-object'}
      role="img"
      aria-label="Drawing"
      tabIndex={0}
      data-object-id={stroke.id}
      data-selected={selected}
      style={style}
      onFocus={(e) => {
        if (e.target === e.currentTarget && !selected) props.onSelect?.(stroke.id);
      }}
    >
      <svg className="stroke-svg" width={Math.max(stroke.width, 1)} height={Math.max(stroke.height, 1)} aria-hidden="true">
        <path
          className="stroke-path"
          d={smoothPath(pts)}
          fill="none"
          stroke={PEN_COLORS[stroke.color]}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/** Registry adapter: the board's generic object props to StrokeObject. */
export function StrokeEntry(props: ObjectProps) {
  const { object, ...rest } = props;
  return <StrokeObject {...rest} stroke={object as StrokeSnap} />;
}
