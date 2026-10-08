import { useRef } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import { useNativeStopPropagation } from '../board/useNativeStopPropagation';

/**
 * Accessible names, so a colour is not carried by the swatch alone (WCAG 1.1.1).
 * `none` reads as "No fill" rather than "None fill".
 */
export const SHAPE_FILL_LABELS: Record<FillColor, string> = {
  none: 'No fill',
  white: 'White fill',
  blue: 'Blue fill',
  green: 'Green fill',
  yellow: 'Yellow fill',
  pink: 'Pink fill',
  grey: 'Grey fill',
};

/** The outline names, in the order the toolbar shows them. */
export const SHAPE_STROKE_LABELS: Record<StrokeColor, string> = {
  dark: 'Dark outline',
  blue: 'Blue outline',
  green: 'Green outline',
  orange: 'Orange outline',
  red: 'Red outline',
  grey: 'Grey outline',
};

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export interface ShapeToolbarProps {
  readonly fill: FillColor;
  readonly stroke: StrokeColor;
  /** Disables every swatch while the board cannot be edited (it failed to load). */
  disabled?: boolean;
  onFill(color: FillColor): void;
  onStroke(color: StrokeColor): void;
}

/**
 * Fill and outline swatches for the selected shape (PRD shape.style): six fills plus
 * "no fill", six outlines. Clicking one changes only that one key of the shape, so
 * its label, size, position and selection stay exactly where they were.
 */
export function ShapeToolbar({ fill, stroke, disabled = false, onFill, onStroke }: ShapeToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);

  return (
    <div
      ref={ref}
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape style"
    >
      {FILLS.map((name) => (
        <button
          key={name}
          type="button"
          className="shape-swatch shape-fill-swatch"
          data-testid={`shape-fill-${name}`}
          data-color-name={name}
          aria-label={SHAPE_FILL_LABELS[name]}
          aria-pressed={fill === name}
          title={SHAPE_FILL_LABELS[name]}
          disabled={disabled}
          style={{
            background: SHAPE_FILL_COLORS[name],
            // "No fill" has to look empty, not like an invisible button.
            ...(name === 'none' ? { backgroundImage: 'linear-gradient(45deg, #fff 45%, #bdbdbd 45%, #bdbdbd 55%, #fff 55%)' } : null),
          }}
          onClick={() => onFill(name)}
        />
      ))}
      <span className="shape-toolbar-sep" aria-hidden="true" />
      {STROKES.map((name) => (
        <button
          key={name}
          type="button"
          className="shape-swatch shape-stroke-swatch"
          data-testid={`shape-stroke-${name}`}
          data-color-name={name}
          aria-label={SHAPE_STROKE_LABELS[name]}
          aria-pressed={stroke === name}
          title={SHAPE_STROKE_LABELS[name]}
          disabled={disabled}
          style={{ background: SHAPE_STROKE_COLORS[name] }}
          onClick={() => onStroke(name)}
        />
      ))}
    </div>
  );
}
