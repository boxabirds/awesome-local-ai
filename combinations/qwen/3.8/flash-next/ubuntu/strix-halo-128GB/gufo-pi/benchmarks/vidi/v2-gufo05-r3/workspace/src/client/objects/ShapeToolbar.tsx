/**
 * The shape's fill and outline picker (story 10, `shape.style`).
 *
 * Rendered inside the existing selection floating bar (the object is still
 * selected while these are used, which is what puts the bar there): two groups of
 * colour swatches, one for the fill and one for the outline. Picking a colour is a
 * single command, so it is one undo step, and a swatch is a real button so it is a
 * tab stop that announces itself ("Blue fill").
 *
 * The colour names are the config's keys, capitalised for people and left as they
 * are for the `fill-*` / `stroke-*` hooks, so a test asks for `fill-blue` rather
 * than for a hex value that the theme is free to change.
 */
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

/** Fill swatches in the order they are offered; `none` is spelled "No fill". */
export const FILL_ORDER: readonly (keyof typeof SHAPE_FILL_COLORS)[] = [
  'none',
  'white',
  'blue',
  'green',
  'yellow',
  'pink',
  'grey',
];

/** Outline swatches in the order they are offered. */
export const STROKE_ORDER: readonly (keyof typeof SHAPE_STROKE_COLORS)[] = [
  'dark',
  'blue',
  'green',
  'orange',
  'red',
  'grey',
];

/** "Blue fill", "No fill". */
export function fillLabel(color: keyof typeof SHAPE_FILL_COLORS): string {
  return color === 'none' ? 'No fill' : `${cap(color)} fill`;
}

/** "Dark outline". */
export function strokeLabel(color: keyof typeof SHAPE_STROKE_COLORS): string {
  return `${cap(color)} outline`;
}

function cap(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
}

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  return (
    <div
      className="shape-toolbar"
      data-shape-toolbar=""
      role="group"
      aria-label="Shape colours"
      // The bar floats over the board: a press here must never start a marquee, a
      // pan, or a drag of the object underneath it.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="note-toolbar-group" role="group" aria-label="Fill colour">
        {FILL_ORDER.map((color) => (
          <button
            key={color}
            type="button"
            className="note-swatch"
            data-fill={color}
            data-testid={`fill-${color}`}
            style={{ background: SHAPE_FILL_COLORS[color] }}
            aria-label={fillLabel(color)}
            aria-pressed={fill === color}
            onClick={() => onFill(color)}
          />
        ))}
      </span>
      <span className="note-toolbar-divider" aria-hidden="true" />
      <span className="note-toolbar-group" role="group" aria-label="Outline colour">
        {STROKE_ORDER.map((color) => (
          <button
            key={color}
            type="button"
            className="note-swatch"
            data-stroke={color}
            data-testid={`stroke-${color}`}
            style={{ background: SHAPE_STROKE_COLORS[color] }}
            aria-label={strokeLabel(color)}
            aria-pressed={stroke === color}
            onClick={() => onStroke(color)}
          />
        ))}
      </span>
    </div>
  );
}
