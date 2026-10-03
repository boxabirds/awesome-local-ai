/**
 * The toolbar of a single selected shape (`shape.style`): fill swatches and outline swatches.
 *
 * It follows the rule every toolbar on this board already keeps — each colour is named in its
 * accessible name and tooltip, never distinguished by colour alone — and adds the one thing a
 * shape has that a note does not: a fill and an outline are separate choices, so there are two
 * rows, and a "no fill" swatch for the shape that is only an outline.
 *
 * Clicking a swatch calls the model's `setShapeStyle` through the given `onFill` / `onStroke`,
 * which changes only that key: the label, size, position and selection are untouched, because
 * colouring a shape is one small thing and not a rewrite of it.
 */
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

/** The accessible name of a fill swatch: "No fill", "Blue fill", … */
function fillLabel(color: FillColor): string {
  return color === 'none' ? 'No fill' : `${color[0]?.toUpperCase()}${color.slice(1)} fill`;
}

/** The accessible name of an outline swatch: "Dark outline", "Red outline", … */
function strokeLabel(color: StrokeColor): string {
  return `${color[0]?.toUpperCase()}${color.slice(1)} outline`;
}

export function ShapeToolbar(props: ShapeToolbarProps) {
  const stop = (event: React.SyntheticEvent) => {
    // A swatch click belongs to the shape, never to the board: it must not clear the
    // selection or start a pan.
    event.stopPropagation();
  };

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((color) => (
        <button
          key={color}
          type="button"
          className={`shape-toolbar__swatch shape-toolbar__swatch--fill${color === props.fill ? ' shape-toolbar__swatch--active' : ''}`}
          style={{ backgroundColor: SHAPE_FILL_COLORS[color] }}
          aria-label={fillLabel(color)}
          aria-pressed={color === props.fill}
          title={fillLabel(color)}
          onPointerDown={stop}
          onClick={() => props.onFill(color)}
        />
      ))}
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((color) => (
        <button
          key={color}
          type="button"
          className={`shape-toolbar__swatch shape-toolbar__swatch--stroke${color === props.stroke ? ' shape-toolbar__swatch--active' : ''}`}
          style={{ backgroundColor: SHAPE_STROKE_COLORS[color] }}
          aria-label={strokeLabel(color)}
          aria-pressed={color === props.stroke}
          title={strokeLabel(color)}
          onPointerDown={stop}
          onClick={() => props.onStroke(color)}
        />
      ))}
    </div>
  );
}
