import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';

/**
 * The shape toolbar (`shape.style`): the swatches a single selected shape gets, six fills
 * plus "no fill" and six outlines.
 *
 * It is deliberately small — swatches, no words — because it sits over the shape it is
 * changing, and because the only thing it changes is one key of one object: clicking a
 * swatch calls `setShapeStyle`, which leaves the label, the box, the position and the
 * selection exactly where they were (PRD: "without changing its label, size, position or
 * selection").
 *
 * The accessible names are the UI text (PRD: "tools and swatches have accessible names"), and
 * they are exported so the tests can name a swatch the way a user reads it.
 */

/** The name each colour is called in a swatch's label, as the PRD's palettes read. */
export const SHAPE_COLOUR_NAMES = {
  // Fills.
  none: 'No',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
  // Outlines.
  dark: 'Dark',
  orange: 'Orange',
  red: 'Red',
} as const satisfies Record<ShapeFillColor | ShapeStrokeColor, string>;

/** `aria-label` of the fill swatch for `colour`: "Blue fill", "No fill". */
export function fillSwatchLabel(colour: ShapeFillColor): string {
  return `${SHAPE_COLOUR_NAMES[colour]} fill`;
}

/** `aria-label` of the outline swatch for `colour`: "Dark outline", "Red outline". */
export function strokeSwatchLabel(colour: ShapeStrokeColor): string {
  return `${SHAPE_COLOUR_NAMES[colour]} outline`;
}

export const SHAPE_FILL_GROUP_LABEL = 'Fill colour';
export const SHAPE_STROKE_GROUP_LABEL = 'Outline colour';

export interface ShapeToolbarProps {
  /** The shape's current fill, so its swatch reads as pressed. */
  fill: ShapeFillColor;
  /** The shape's current outline. */
  stroke: ShapeStrokeColor;
  onFill(colour: ShapeFillColor): void;
  onStroke(colour: ShapeStrokeColor): void;
}

/**
 * The swatches, in the order the settings list them — which is the order the palette is
 * written in the PRD, so the toolbar and the settings never drift apart.
 */
export function ShapeToolbar({
  fill,
  stroke,
  onFill,
  onStroke,
}: ShapeToolbarProps): JSX.Element {
  return (
    <div className="vidi6-shape-toolbar" data-testid="shape-toolbar">
      <div
        className="vidi6-shape-swatches"
        data-testid="shape-fill-swatches"
        role="group"
        aria-label={SHAPE_FILL_GROUP_LABEL}
      >
        {(Object.keys(SHAPE_FILL_COLORS) as ShapeFillColor[]).map((colour) => (
          <button
            key={colour}
            type="button"
            className="vidi6-shape-swatch"
            data-testid={`shape-fill-${colour}`}
            data-colour={colour}
            aria-label={fillSwatchLabel(colour)}
            title={fillSwatchLabel(colour)}
            aria-pressed={fill === colour}
            style={{
              background: SHAPE_FILL_COLORS[colour],
              // "No fill" has to be visible on a white shape, so it carries a ring instead
              // of a colour of its own.
              boxShadow: colour === 'none' ? 'inset 0 0 0 1px #9aa2b1' : undefined,
            }}
            onClick={() => onFill(colour)}
          />
        ))}
      </div>
      <div
        className="vidi6-shape-swatches"
        data-testid="shape-stroke-swatches"
        role="group"
        aria-label={SHAPE_STROKE_GROUP_LABEL}
      >
        {(Object.keys(SHAPE_STROKE_COLORS) as ShapeStrokeColor[]).map((colour) => (
          <button
            key={colour}
            type="button"
            className="vidi6-shape-swatch"
            data-testid={`shape-stroke-${colour}`}
            data-colour={colour}
            aria-label={strokeSwatchLabel(colour)}
            title={strokeSwatchLabel(colour)}
            aria-pressed={stroke === colour}
            style={{ background: SHAPE_STROKE_COLORS[colour] }}
            onClick={() => onStroke(colour)}
          />
        ))}
      </div>
    </div>
  );
}
