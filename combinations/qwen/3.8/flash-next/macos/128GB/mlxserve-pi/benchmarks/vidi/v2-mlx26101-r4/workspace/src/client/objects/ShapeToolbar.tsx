/**
 * The toolbar that floats above a selected shape: the fills, then the outlines.
 *
 * Two rows of swatches in one strip, because they are one question with two answers — what is this shape
 * filled with, and what is it drawn with — and a person decides both at the same moment. They are kept
 * visibly apart rather than interleaved because a blue square means *blue fill* in one group and *blue
 * outline* in the other, and a swatch whose meaning depends on where in the strip it sits is a swatch that
 * has to be looked at twice.
 *
 * Like the note's colours it is drawn in screen space (the shape counter-scales it), so it stays the size
 * of a target at every zoom; and every swatch carries the colour's name and which of the two it is in its
 * accessible name, so "blue fill" and "blue outline" are two different sentences to anybody who cannot see
 * the difference between them.
 *
 * It reports decisions and changes nothing itself: `onFill` and `onStroke` go to `setShapeStyle`, which is
 * the only place a colour is ever written — a toolbar that wrote to the document would be a second model of
 * what a shape is, sitting next to the first one and disagreeing with it as soon as the model changed.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';

/** The order the swatches appear in, which is the order the named settings list them in. */
const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

/** "blue" reads as "Blue" in a label and a tooltip. */
function labelOf(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export interface ShapeToolbarProps {
  /** The colour name the shape stores, which is the swatch that reads as pressed. */
  fill: string;
  stroke: string;
  onFill(fill: string): void;
  onStroke(stroke: string): void;
  /**
   * Grey the whole thing out: on a board that could not be loaded the shape is not yours to repaint. The
   * model refuses the write whatever happens here; this is so the shape does not offer a command that goes
   * nowhere.
   */
  disabled?: boolean;
}

export function ShapeToolbar({ fill, stroke, onFill, onStroke, disabled = false }: ShapeToolbarProps): JSX.Element {
  /** A click here is a command, never a board gesture: no pan, no deselect, no marquee. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {FILLS.map((name) => (
        <button
          key={`fill-${name}`}
          type="button"
          className="shape-toolbar__swatch shape-toolbar__swatch--fill"
          data-testid={`fill-${name}`}
          data-fill={name}
          aria-label={`${labelOf(name)} fill`}
          aria-pressed={fill === name}
          title={`${labelOf(name)} fill`}
          style={{ backgroundColor: SHAPE_FILL_COLORS[name] }}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onFill(name);
          }}
        />
      ))}
      {/* The two groups, said out loud: a divider is a hint only sighted people get. */}
      <span className="shape-toolbar__divider" aria-hidden="true" />
      {STROKES.map((name) => (
        <button
          key={`stroke-${name}`}
          type="button"
          className="shape-toolbar__swatch shape-toolbar__swatch--stroke"
          data-testid={`stroke-${name}`}
          data-stroke={name}
          aria-label={`${labelOf(name)} outline`}
          aria-pressed={stroke === name}
          title={`${labelOf(name)} outline`}
          style={{ backgroundColor: SHAPE_STROKE_COLORS[name] }}
          disabled={disabled}
          onClick={() => {
            if (disabled) return;
            onStroke(name);
          }}
        />
      ))}
    </div>
  );
}
