import type { JSX } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

/**
 * The fill / outline names shown to users. `none` reads as "No fill" rather than
 * "None fill", which is why it has its own label instead of a generic template.
 */
function colorName(key: string): string {
  if (key === 'none') return 'No fill';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
  /** Delete the shape, when the caller offers it (keyboard Delete also works). */
  onDelete?(): void;
}

/**
 * The swatch toolbar above a single selected shape (`shape.style`): six fill
 * colours plus no fill, six outline colours. Picking one changes only the
 * colour — the label, size, position and selection are untouched — and each
 * choice is one undo step.
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke, onDelete }: ShapeToolbarProps): JSX.Element {
  return (
    <div className="note-toolbar shape-toolbar" data-testid="shape-toolbar" role="toolbar" aria-label="Shape colours">
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((key) => (
        <button
          key={key}
          type="button"
          className="note-toolbar-swatch"
          data-testid={`shape-fill-${key}`}
          aria-label={`${colorName(key)} fill`}
          title={`${colorName(key)} fill`}
          aria-pressed={fill === key}
          onClick={() => onFill(key)}
          style={{ background: SHAPE_FILL_COLORS[key] }}
        />
      ))}
      <span className="shape-toolbar-divider" aria-hidden="true" />
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((key) => (
        <button
          key={key}
          type="button"
          className="note-toolbar-swatch shape-toolbar-outline"
          data-testid={`shape-stroke-${key}`}
          aria-label={`${colorName(key)} outline`}
          title={`${colorName(key)} outline`}
          aria-pressed={stroke === key}
          onClick={() => onStroke(key)}
          style={{ background: SHAPE_STROKE_COLORS[key] }}
        />
      ))}
      {onDelete !== undefined && (
        <button
          type="button"
          className="note-toolbar-delete"
          data-testid="shape-toolbar-delete"
          aria-label="Delete shape"
          title="Delete shape"
          onClick={onDelete}
        >
          <span aria-hidden="true">&#x1F5D1;</span>
        </button>
      )}
    </div>
  );
}
