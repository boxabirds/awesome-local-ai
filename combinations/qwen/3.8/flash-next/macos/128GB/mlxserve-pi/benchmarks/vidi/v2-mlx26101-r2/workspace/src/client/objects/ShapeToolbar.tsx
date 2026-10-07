import type { JSX } from 'react';

import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config.js';

/**
 * The toolbar of one selected shape (`src/client/objects/ShapeToolbar.tsx`).
 *
 * A shape is the first object on the board with *two* colours, and the two palettes
 * are not the same list: six fills plus "no fill", six outlines. They are shown as
 * two groups rather than one row of thirteen because a fill and an outline called
 * "blue" are different blues doing different jobs, and pressing one must not look
 * like a way to change the other.
 *
 * Like the text toolbar it is shown inside the board's selection bar, so the board
 * has one floating toolbar whatever is selected. It asks for a colour and does not
 * apply one: the shape's own module checks the name and writes the one field, which
 * is what leaves the label, the size and the selection alone while somebody else is
 * typing in the shape (`shape.style`).
 */

/** A fill swatch's accessible name: "blue fill", "no fill". */
export const fillLabel = (colour: FillColor): string =>
  colour === 'none' ? 'no fill' : `${colour} fill`;

/** An outline swatch's accessible name: "blue outline". */
export const strokeLabel = (colour: StrokeColor): string => `${colour} outline`;

export interface ShapeToolbarProps {
  /** The fill the shape has now. */
  fill: FillColor;
  /** The outline the shape has now. */
  stroke: StrokeColor;
  /** Fill the shape this colour (`none` takes the fill away). */
  onFill(colour: FillColor): void;
  /** Outline the shape this colour. */
  onStroke(colour: StrokeColor): void;
  /** Remove the selection this toolbar belongs to. */
  onDelete(): void;
}

export function ShapeToolbar({
  fill,
  stroke,
  onFill,
  onStroke,
  onDelete,
}: ShapeToolbarProps): JSX.Element {
  return (
    <div
      className="shape-toolbar"
      role="toolbar"
      aria-label="Shape"
      data-testid="shape-toolbar"
      data-fill={fill}
      data-stroke={stroke}
    >
      <span className="shape-toolbar-group" data-testid="shape-fill-group">
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((colour) => (
          <button
            key={colour}
            type="button"
            className="shape-swatch shape-fill-swatch"
            data-testid="shape-fill-button"
            data-color={colour}
            aria-label={fillLabel(colour)}
            title={`Fill the shape ${fillLabel(colour)}`}
            aria-pressed={fill === colour ? 'true' : 'false'}
            style={{ ['--swatch' as string]: SHAPE_FILL_COLORS[colour] }}
            onClick={() => onFill(colour)}
          />
        ))}
      </span>
      <span className="shape-toolbar-group" data-testid="shape-stroke-group">
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((colour) => (
          <button
            key={colour}
            type="button"
            className="shape-swatch shape-stroke-swatch"
            data-testid="shape-stroke-button"
            data-color={colour}
            aria-label={strokeLabel(colour)}
            title={`Outline the shape ${strokeLabel(colour)}`}
            aria-pressed={stroke === colour ? 'true' : 'false'}
            style={{ ['--swatch' as string]: SHAPE_STROKE_COLORS[colour] }}
            onClick={() => onStroke(colour)}
          />
        ))}
      </span>
      <button
        type="button"
        className="shape-toolbar-delete"
        data-testid="shape-toolbar-delete"
        aria-label="Delete"
        title="Delete this shape (Delete)"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}

export default ShapeToolbar;
