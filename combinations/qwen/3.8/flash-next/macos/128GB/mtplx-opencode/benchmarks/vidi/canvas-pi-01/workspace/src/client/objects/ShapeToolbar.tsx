/**
 * Story 10 · task 12 — the shape toolbar (design "ShapeToolbar", PRD
 * `shape.style`).
 *
 * Shown for exactly one selected shape. Two rows of swatches: the seven fills
 * (six colours plus *no fill*) and the six outline colours. Every swatch carries
 * an accessible name ("<colour> fill" / "<colour> outline") and an
 * `aria-pressed` state, so the choice is never colour-only, and pointer events
 * are stopped so a click here cannot clear the selection the bar depends on.
 */
import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';

export interface ShapeToolbarProps {
  fill: string;
  stroke: string;
  onFill(fill: string): void;
  onStroke(stroke: string): void;
}

/** Capitalised colour name for the accessible label. */
const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const FILLS = Object.keys(SHAPE_FILL_COLORS);
const STROKES = Object.keys(SHAPE_STROKE_COLORS);

export function ShapeToolbar(props: ShapeToolbarProps): JSX.Element {
  const { fill, stroke, onFill, onStroke } = props;
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape actions"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      <div className="shape-swatches" data-testid="shape-fills">
        {FILLS.map((name) => (
          <button
            key={`fill-${name}`}
            type="button"
            className="swatch"
            data-testid={`fill-${name}`}
            data-color={name}
            aria-label={`${label(name)} fill`}
            aria-pressed={fill === name}
            style={{
              backgroundColor: SHAPE_FILL_COLORS[name as keyof typeof SHAPE_FILL_COLORS],
              backgroundImage: name === 'none' ? 'none' : undefined,
            }}
            onPointerDown={stop}
            onClick={(event) => {
              event.stopPropagation();
              onFill(name);
            }}
          />
        ))}
      </div>
      <div className="shape-swatches" data-testid="shape-strokes">
        {STROKES.map((name) => (
          <button
            key={`stroke-${name}`}
            type="button"
            className="swatch swatch-outline"
            data-testid={`stroke-${name}`}
            data-color={name}
            aria-label={`${label(name)} outline`}
            aria-pressed={stroke === name}
            style={{ backgroundColor: SHAPE_STROKE_COLORS[name as keyof typeof SHAPE_STROKE_COLORS] }}
            onPointerDown={stop}
            onClick={(event) => {
              event.stopPropagation();
              onStroke(name);
            }}
          />
        ))}
      </div>
    </div>
  );
}
