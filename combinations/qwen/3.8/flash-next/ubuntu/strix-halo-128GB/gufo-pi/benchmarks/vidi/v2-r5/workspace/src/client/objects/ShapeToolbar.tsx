import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

/**
 * ShapeToolbar: fill and outline colour swatches for a selected shape.
 * Only shown when exactly one shape is selected.
 *
 * Buttons use aria-label="<colour> fill" and "<colour> outline".
 */
export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}

const FILL_ORDER: FillColor[] = ['white', 'blue', 'green', 'yellow', 'pink', 'grey', 'none'];
const STROKE_ORDER: StrokeColor[] = ['dark', 'blue', 'green', 'orange', 'red', 'grey'];

/** Capitalize first letter of a colour key for the aria-label. */
const label = (key: string): string => key.charAt(0).toUpperCase() + key.slice(1);

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  const stop = (e: React.SyntheticEvent): void => { e.stopPropagation(); };

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape style"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      <div className="shape-toolbar-row" role="group" aria-label="Fill colours">
        {FILL_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`shape-swatch${fill === key ? ' shape-swatch-active' : ''}`}
            aria-label={`${label(key)} fill`}
            title={`${label(key)} fill`}
            style={{ backgroundColor: SHAPE_FILL_COLORS[key], border: '1px solid #999' }}
            onClick={() => onFill(key)}
          />
        ))}
      </div>
      <div className="shape-toolbar-row" role="group" aria-label="Outline colours">
        {STROKE_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`shape-swatch${stroke === key ? ' shape-swatch-active' : ''}`}
            aria-label={`${label(key)} outline`}
            title={`${label(key)} outline`}
            style={{ backgroundColor: SHAPE_STROKE_COLORS[key], border: '1px solid #999' }}
            onClick={() => onStroke(key)}
          />
        ))}
      </div>
    </div>
  );
}
