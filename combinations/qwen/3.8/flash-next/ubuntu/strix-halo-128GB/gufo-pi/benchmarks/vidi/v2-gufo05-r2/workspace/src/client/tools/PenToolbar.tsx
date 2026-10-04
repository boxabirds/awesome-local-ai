/**
 * Story 11: the pen's two choices — colour and weight.
 *
 * Six swatches and three thicknesses, and one rule: picking one changes the *next*
 * stroke and nothing else (PRD pen.options.no_restyle). That is why this toolbar is not
 * the selection toolbar — a stroke's colour is stored in the stroke, and a picker that
 * sat next to a selected drawing would imply the drawing could be painted afterwards
 * (which the PRD puts out of scope).
 *
 * It appears only while the Pen tool is held, next to the left toolbar, so the choice is
 * where the hand already is. Both sets are `role="group"` with exactly one
 * `aria-pressed`, the way the shape kinds and the tools are done: a screen reader hears
 * "blue pen, pressed" without being told which of six circles is which.
 */

import type { CSSProperties } from 'react';

import type { PenColor, PenThickness } from '../../shared/config';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

/** The colours, in the order the toolbar shows them: black first, as the PRD lists them. */
export const PEN_COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];

/** The weights, thinnest first. */
export const PEN_THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

/** Accessible names of the weights: `button[aria-label="Thin"]` and so on. */
export const PEN_THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/**
 * How wide each weight's mark looks in its button: the three widths next to each other
 * is what tells a person which one is "thick", so the marks keep the same ratio as the
 * strokes they stand for (2, 4 and 8 board units) rather than being three arbitrary dots.
 */
const MARK_WIDTH_PX: Record<PenThickness, number> = {
  thin: 2,
  medium: 4,
  thick: 7,
};

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="group"
      aria-label="Pen options"
      // The board sits under this layer with the Pen tool holding the pointer: a press
      // here chooses a pen setting and must never start a stroke.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="pen-toolbar__group" role="group" aria-label="Pen colour">
        {PEN_COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="pen-toolbar__swatch"
            style={{ ['--swatch' as string]: PEN_COLORS[name] } as CSSProperties}
            aria-label={`${name} pen`}
            title={`${name} pen`}
            data-testid={`pen-color-${name}`}
            aria-pressed={color === name}
            onClick={() => onColor(name)}
          />
        ))}
      </div>
      <div className="pen-toolbar__group" role="group" aria-label="Pen thickness">
        {PEN_THICKNESS_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="pen-toolbar__thickness"
            aria-label={PEN_THICKNESS_LABELS[name]}
            title={PEN_THICKNESS_LABELS[name]}
            data-testid={`pen-thickness-${name}`}
            aria-pressed={thickness === name}
            onClick={() => onThickness(name)}
          >
            <span
              className="pen-toolbar__mark"
              aria-hidden="true"
              style={
                {
                  height: `${MARK_WIDTH_PX[name]}px`,
                  background: PEN_COLORS[color],
                } as CSSProperties
              }
            />
          </button>
        ))}
      </div>
    </div>
  );
}
