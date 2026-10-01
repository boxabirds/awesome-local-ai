// The Shape toolbar (story 10): the colours of the one shape that is selected.
//
// Two rows of swatches in one bar - the fill that goes inside the shape and the
// outline that goes round it - because they are the same act done to the same
// object, and two bars would fight over the same corner of the screen. A swatch
// says the colour it is ("Blue fill", "Dark outline"), which is also how a
// keyboard or a screen-reader user chooses one, and the swatch of the colour the
// shape already wears stays pressed, so the bar states what it would change.
//
// Clicking a swatch changes that one colour and nothing else: the shape keeps its
// label, its size, its place and - because the selection is never touched - the
// fact that you were working on it.

import { type JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

/** What the bar calls each fill, before the word "fill". */
export const SHAPE_FILL_NAMES: Readonly<Record<FillColor, string>> = {
  none: 'No',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
};

/** What the bar calls each outline, before the word "outline". */
export const SHAPE_STROKE_NAMES: Readonly<Record<StrokeColor, string>> = {
  dark: 'Dark',
  blue: 'Blue',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  grey: 'Grey',
};

/** The order the fill swatches stand in: no fill first, then the six colours. */
export const SHAPE_FILL_ORDER = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
/** The order the outline swatches stand in. */
export const SHAPE_STROKE_ORDER = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export interface ShapeToolbarProps {
  /** The one selected shape's colours. */
  fill: FillColor;
  stroke: StrokeColor;
  /** A fill swatch: the shape takes this colour inside. */
  onFill(color: FillColor): void;
  /** An outline swatch: the shape takes this colour round the edge. */
  onStroke(color: StrokeColor): void;
  /** The bin. Given, the bar shows one; a shape has always had a way to go. */
  onDelete?(): void;
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
      data-testid="shape-toolbar"
      role="group"
      aria-label="Shape toolbar"
    >
      <span className="shape-toolbar__row" data-testid="shape-fill-row">
        {SHAPE_FILL_ORDER.map((color) => (
          <button
            key={color}
            type="button"
            className={`shape-swatch shape-swatch--fill${color === 'none' ? ' shape-swatch--none' : ''}`}
            data-testid={`shape-fill-${color}`}
            data-color={color}
            aria-label={`${SHAPE_FILL_NAMES[color]} fill`}
            aria-pressed={color === fill}
            title={`${SHAPE_FILL_NAMES[color]} fill`}
            style={{ background: SHAPE_FILL_COLORS[color] }}
            onClick={() => {
              onFill(color);
            }}
          />
        ))}
      </span>
      <span className="shape-toolbar__divider" aria-hidden="true" />
      <span className="shape-toolbar__row" data-testid="shape-stroke-row">
        {SHAPE_STROKE_ORDER.map((color) => (
          <button
            key={color}
            type="button"
            className="shape-swatch shape-swatch--stroke"
            data-testid={`shape-stroke-${color}`}
            data-color={color}
            aria-label={`${SHAPE_STROKE_NAMES[color]} outline`}
            aria-pressed={color === stroke}
            title={`${SHAPE_STROKE_NAMES[color]} outline`}
            style={{ background: SHAPE_STROKE_COLORS[color] }}
            onClick={() => {
              onStroke(color);
            }}
          />
        ))}
      </span>
      {onDelete === undefined ? null : (
        <>
          <span className="shape-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            data-testid="shape-toolbar-delete"
            className="text-toolbar-button text-toolbar-button--danger"
            onClick={() => {
              onDelete();
            }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );
}
