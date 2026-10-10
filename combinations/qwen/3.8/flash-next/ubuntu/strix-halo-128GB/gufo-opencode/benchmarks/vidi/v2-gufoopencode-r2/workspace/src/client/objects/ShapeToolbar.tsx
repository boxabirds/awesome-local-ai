// Toolbar for a single selected shape: seven fill swatches (including "no
// fill") and six outline swatches. Rendered in the selection bar, counter-scaled
// like the other toolbars. A click changes only fill or stroke, so the label,
// size, position and selection are untouched.

import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

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

const FILL_KEYS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_KEYS = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps): React.JSX.Element {
  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {FILL_KEYS.map((name) => (
        <button
          key={name}
          type="button"
          className="shape-swatch"
          data-testid={`shape-fill-${name}`}
          aria-label={`${FILL_NAMES[name]} fill`}
          title={`${FILL_NAMES[name]} fill`}
          aria-pressed={name === fill}
          style={{ background: SHAPE_FILL_COLORS[name] }}
          onClick={() => onFill(name)}
        />
      ))}
      {STROKE_KEYS.map((name) => (
        <button
          key={name}
          type="button"
          className="shape-swatch shape-stroke-swatch"
          data-testid={`shape-stroke-${name}`}
          aria-label={`${STROKE_NAMES[name]} outline`}
          title={`${STROKE_NAMES[name]} outline`}
          aria-pressed={name === stroke}
          style={{ background: SHAPE_STROKE_COLORS[name] }}
          onClick={() => onStroke(name)}
        />
      ))}
    </div>
  );
}
