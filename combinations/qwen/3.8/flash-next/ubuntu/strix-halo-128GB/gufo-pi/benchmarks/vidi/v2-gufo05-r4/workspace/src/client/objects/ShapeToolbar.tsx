/**
 * The floating toolbar of the selected shape: seven fills and six outlines.
 *
 * It is the whole of `shape.style`. Two rules shape it:
 *
 *  - **the colour is a name, not a hex.** The buttons carry the palette names from
 *    `src/shared/config.ts`, and clicking one writes the name; the hexes live in one file so a
 *    recolouring of the product is one edit and nobody has to parse a colour out of a
 *    document;
 *  - **one click changes one thing.** Fill and outline are separate writes, so colouring a
 *    shape leaves its label, its size, its position and the selection exactly as they were —
 *    which is what makes it possible to draw a diagram's colour code without redrawing the
 *    diagram.
 *
 * Like the note and text toolbars it lives inside the shape and is counter-scaled by `1 / zoom`
 * (`transform-origin: 50% 100%`), so it stays a constant size on screen whatever the zoom, and
 * every control stops the pointer rather than becoming a board gesture.
 */

import type { CSSProperties, JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor
} from '../../shared/config';

export interface ShapeToolbarProps {
  /** The shape's current fill, which is the pressed swatch. */
  fill: FillColor;
  /** The shape's current outline, which is the pressed swatch. */
  stroke: StrokeColor;
  onFill(colour: FillColor): void;
  onStroke(colour: StrokeColor): void;
  /** False while the board cannot be written to (story 4): nothing here does anything. */
  disabled?: boolean;
}

/** The order the fills are offered in: none first, because "unfill" is a thing users look for. */
const FILL_ORDER = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
/** The order the outlines are offered in, dark first because it is the default. */
const STROKE_ORDER = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

/** Capitalised for the button's accessible name; `none` is said as English rather than "None fill". */
function colourName(colour: string): string {
  if (colour === 'none') return 'No fill';
  return colour.charAt(0).toUpperCase() + colour.slice(1);
}

/**
 * The swatch's colour, as a custom property rather than a background.
 *
 * A fill swatch is the colour and an outline swatch is a ring of it, so the same value has to
 * be usable two ways; `var(--vidi6-swatch)` is how it gets there without the stylesheet having
 * to know the palette.
 */
const swatchStyle = (hex: string): CSSProperties => ({ ['--vidi6-swatch' as string]: hex } as CSSProperties);

/** Pointer and double-click events stop here: a click on a swatch is not a board gesture. */
const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;
  const disabled = props.disabled === true;

  return (
    <div
      className="vidi6-shape-toolbar"
      data-vidi6="shape-toolbar"
      role="toolbar"
      aria-label="Shape options"
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
    >
      {FILL_ORDER.map((colour) => (
        <button
          key={colour}
          type="button"
          className="vidi6-shape-swatch"
          data-vidi6="shape-swatch"
          data-role="fill"
          data-color={colour}
          aria-label={`${colourName(colour)} fill`}
          title={`${colourName(colour)} fill`}
          aria-pressed={colour === fill}
          aria-disabled={disabled}
          disabled={disabled}
          style={swatchStyle(SHAPE_FILL_COLORS[colour])}
          onClick={() => onFill(colour)}
        />
      ))}
      <span className="vidi6-shape-toolbar-separator" aria-hidden="true" />
      {STROKE_ORDER.map((colour) => (
        <button
          key={colour}
          type="button"
          className="vidi6-shape-swatch vidi6-shape-swatch--outline"
          data-vidi6="shape-swatch"
          data-role="stroke"
          data-color={colour}
          aria-label={`${colourName(colour)} outline`}
          title={`${colourName(colour)} outline`}
          aria-pressed={colour === stroke}
          aria-disabled={disabled}
          disabled={disabled}
          style={swatchStyle(SHAPE_STROKE_COLORS[colour])}
          onClick={() => onStroke(colour)}
        />
      ))}
    </div>
  );
}
