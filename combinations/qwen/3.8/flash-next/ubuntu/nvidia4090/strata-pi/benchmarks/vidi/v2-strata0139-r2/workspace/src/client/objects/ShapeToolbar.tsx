import { SHAPE_FILL_COLORS, SHAPE_FILL_NAMES, SHAPE_STROKE_COLORS, SHAPE_STROKE_NAMES, type FillColor, type StrokeColor } from "../../shared/config";

/**
 * A shape's own toolbar (`shape.style`, story 10).
 *
 * Six fill swatches plus "no fill", and six outline swatches. Clicking one
 * changes only that key of the shape — its label, its size, its position and the
 * selection are left exactly as they were, because `setShapeStyle` writes the
 * colour keys and nothing else.
 *
 * The swatches are shown against the colour they stand for, and the one the shape
 * already has is marked with `aria-pressed`, so the shape's current style is
 * readable without opening anything.
 */

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(fill: FillColor): void;
  onStroke(stroke: StrokeColor): void;
}

export function ShapeToolbar({ fill, stroke, onFill, onStroke }: ShapeToolbarProps) {
  return (
    <div className="shape-toolbar" data-testid="shape-toolbar" role="toolbar" aria-label="Shape style">
      <div className="shape-toolbar-row" data-testid="shape-fill-row">
        {SHAPE_FILL_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="shape-swatch"
            data-testid={`shape-fill-${name}`}
            data-colour={name}
            aria-label={`${name} fill`}
            title={`${name} fill`}
            aria-pressed={fill === name}
            style={{ background: SHAPE_FILL_COLORS[name] }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onFill(name)}
          />
        ))}
      </div>
      <div className="shape-toolbar-row" data-testid="shape-stroke-row">
        {SHAPE_STROKE_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="shape-swatch shape-swatch-stroke"
            data-testid={`shape-stroke-${name}`}
            data-colour={name}
            aria-label={`${name} outline`}
            title={`${name} outline`}
            aria-pressed={stroke === name}
            style={{ background: SHAPE_STROKE_COLORS[name] }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onStroke(name)}
          />
        ))}
      </div>
    </div>
  );
}
