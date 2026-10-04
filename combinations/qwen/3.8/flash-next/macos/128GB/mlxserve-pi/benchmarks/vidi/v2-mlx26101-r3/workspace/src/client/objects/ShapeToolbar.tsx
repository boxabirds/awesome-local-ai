import type { CSSProperties, JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
}

/** What each colour is called in the button's label. */
const FILL_NAMES: Record<FillColor, string> = {
  none: 'No',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
};

const STROKE_NAMES: Record<StrokeColor, string> = {
  dark: 'Dark',
  blue: 'Blue',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  grey: 'Grey',
};

export interface SwatchProps {
  name: string;
  color: string;
  pressed: boolean;
  outline?: boolean;
  onPick(): void;
}

/**
 * One colour, one button.
 *
 * The label is "Blue fill" or "Blue outline" rather than "Blue" because there are two rows of
 * identical colour names on the screen at once, and a keyboard user navigating by label should be
 * told which of the two they are about to change. The empty one is "No fill", which is the phrase
 * that means what it does: the shape keeps its outline and loses its insides.
 */
export function Swatch({ name, color, pressed, outline = false, onPick }: SwatchProps): JSX.Element {
  return (
    <button
      type="button"
      className="shape-toolbar__swatch"
      data-testid={outline ? `stroke-${name.toLowerCase()}` : `fill-${name.toLowerCase()}`}
      aria-label={`${name} ${outline ? 'outline' : 'fill'}`}
      aria-pressed={pressed}
      title={`${name} ${outline ? 'outline' : 'fill'}`}
      onClick={onPick}
      style={
        {
          '--swatch': color,
          '--swatch-outline': pressed ? 'currentColor' : 'transparent',
        } as CSSProperties
      }
    />
  );
}

/**
 * The shape's colours, shown when exactly one shape is selected.
 *
 * Two rows, because a shape has two colours and they are different questions: what is inside it, and
 * what is drawn around it. Six fills and six outlines, in the order the palettes are written, with
 * the empty fill first among the fills - a shape with no fill is how you draw an outline you can type
 * into without hiding what is behind it.
 *
 * Clicking one changes one key of the shape and nothing else. That is not a note about this component,
 * which draws no state of its own, but about what it calls: `setShapeStyle` writes `fill` or `stroke`
 * and leaves the label, the box, the position and the selection alone, so the shape does not move,
 * empty itself or lose its outline marks while you are choosing its colour. The pressed swatch is read
 * from the object that came in as a prop, which came from the document, which is the only reason it
 * says the right thing a moment after the click.
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): JSX.Element {
  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape colours"
      onPointerDown={(event) => {
        // A swatch is pressed, not dragged: a press on the toolbar never carries the shape about,
        // never pans the board and never draws a marquee behind the toolbar.
        event.stopPropagation();
      }}
    >
      <span className="shape-toolbar__group" data-testid="shape-fill-group">
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((color) => (
          <Swatch
            key={color}
            name={FILL_NAMES[color]}
            color={SHAPE_FILL_COLORS[color]}
            pressed={fill === color}
            onPick={() => {
              onFill(color);
            }}
          />
        ))}
      </span>
      <span className="shape-toolbar__divider" aria-hidden="true" />
      <span className="shape-toolbar__group" data-testid="shape-stroke-group">
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((color) => (
          <Swatch
            key={color}
            name={STROKE_NAMES[color]}
            color={SHAPE_STROKE_COLORS[color]}
            pressed={stroke === color}
            outline
            onPick={() => {
              onStroke(color);
            }}
          />
        ))}
      </span>
    </div>
  );
}
