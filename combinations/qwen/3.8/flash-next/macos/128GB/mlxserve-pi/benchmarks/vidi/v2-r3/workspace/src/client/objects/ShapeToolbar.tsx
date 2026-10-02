import type { JSX } from 'react';
import {
  SHAPE_COLOR_LABELS,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';

export interface ShapeToolbarProps {
  /** The shape's current fill: its swatch is the pressed one. `none` is a colour. */
  fill: ShapeFillColor;
  /** The shape's current outline. */
  stroke: ShapeStrokeColor;
  onFill(color: ShapeFillColor): void;
  onStroke(color: ShapeStrokeColor): void;
}

/** Fill swatch order: `none` first, because a shape that is only an outline is
 *  the common case and the choice should be the first one offered. */
const FILL_ORDER: readonly ShapeFillColor[] = ['none', 'white', 'blue', 'green', 'yellow', 'pink', 'grey'];

/** Outline swatch order, dark first: it is what a new shape is drawn with. */
const STROKE_ORDER: readonly ShapeStrokeColor[] = ['dark', 'blue', 'green', 'orange', 'red', 'grey'];

/**
 * The floating toolbar of the selected shape: the fills it can be given and the
 * outlines it can be drawn with (design section 5.4).
 *
 * It is a child of the shape, so it appears and goes with it, and it is scaled by
 * 1/zoom in CSS, so it stays the same size on screen at any zoom — the same trick
 * a sticky note's toolbar uses, for the same reason.
 *
 * Every pointer event is stopped here. A click on a swatch that reached the
 * viewport would be read as a click on empty board space, which would clear the
 * selection, and the shape whose colours were being chosen would no longer be
 * selected while they were being written.
 */
export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const stop = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
  };

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
    >
      {FILL_ORDER.map((color) => (
        <button
          key={color}
          type="button"
          className={`shape-swatch shape-fill-swatch shape-fill-swatch-${color}`}
          data-testid={`shape-fill-${color}`}
          data-role="fill"
          aria-label={`${SHAPE_COLOR_LABELS[color]} fill`}
          title={`${SHAPE_COLOR_LABELS[color]} fill`}
          aria-pressed={color === props.fill}
          style={{ backgroundColor: SHAPE_FILL_COLORS[color] }}
          onClick={() => {
            props.onFill(color);
          }}
        />
      ))}
      <span className="shape-toolbar-sep" aria-hidden="true" />
      {STROKE_ORDER.map((color) => (
        <button
          key={color}
          type="button"
          className={`shape-swatch shape-stroke-swatch shape-stroke-swatch-${color}`}
          data-testid={`shape-stroke-${color}`}
          data-role="stroke"
          aria-label={`${SHAPE_COLOR_LABELS[color]} outline`}
          title={`${SHAPE_COLOR_LABELS[color]} outline`}
          aria-pressed={color === props.stroke}
          style={{ backgroundColor: SHAPE_STROKE_COLORS[color] }}
          onClick={() => {
            props.onStroke(color);
          }}
        />
      ))}
    </div>
  );
}
