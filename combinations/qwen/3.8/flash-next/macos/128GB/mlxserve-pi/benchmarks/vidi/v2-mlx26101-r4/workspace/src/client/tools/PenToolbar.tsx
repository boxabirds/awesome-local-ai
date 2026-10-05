/**
 * The pen's own options: which ink, and which nib.
 *
 * A second strip beside the toolbar, shown only while the Pen tool is armed — the same rule the Shape kind
 * menu follows. Both are decisions about *what to draw next*, and while another tool is up there is nothing
 * here for them to be a decision about; a control nobody can see the effect of is a control that should not
 * be on the screen. (A stroke already drawn is not affected by either button, ever: it carries the names it was
 * drawn with, and `pen.options` is explicit that existing strokes are never restyled.)
 *
 * Six colours and three widths are nine buttons, and they are two questions rather than nine: nine swatches
 * in a row would make the width choice look like a shade of ink. So the inks are drawn as the colour they are
 * (a swatch is the only honest label for a colour — "Orange pen" and "Red pen" are a small disaster for
 * somebody who cannot see the difference) and the nibs are drawn as words with dots sized like the lines they
 * make, because there `thin` and `thick` *are* the names.
 *
 * Every button carries `aria-pressed`, which is what makes the current choice readable without looking: the
 * pen has one ink and one nib at a time, so exactly one button in each group reads as pressed. The line under
 * both groups is a live region, polite because it is a confirmation and not an alert, and it is the only place
 * where the two choices are said as one sentence — which is also what a screen reader wants when the answer to
 * "what is the pen set to?" is two words long.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import { PEN_COLORS, PEN_THICKNESS_ORDER, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';

/** The accessible name of each ink, as the design spells it: `<colour> pen`. */
export const PEN_COLOR_LABELS: Record<PenColor, string> = {
  black: 'Black pen',
  blue: 'Blue pen',
  red: 'Red pen',
  green: 'Green pen',
  orange: 'Orange pen',
  purple: 'Purple pen',
};

/** The accessible name of each nib. These are the widths' own names, so no noun is added. */
export const PEN_THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** What the two groups are called, for the toolbar's own labelling. */
export const PEN_TOOLBAR_LABEL = 'Pen options';

/** The sentence the live region says: the two choices, in the order they are asked. */
export function penOptionSummary(color: PenColor, thickness: PenThickness): string {
  return `${color} ${thickness} pen`;
}

export interface PenToolbarProps {
  /** The ink the pen is filled with right now, which is the swatch that reads as pressed. */
  color: PenColor;
  /** The nib the pen is fitted with right now. */
  thickness: PenThickness;
  /** Fill the pen. Nothing is written to the document and nothing already drawn changes. */
  onColor(color: PenColor): void;
  /** Fit the nib. */
  onThickness(thickness: PenThickness): void;
  /** Take the whole panel out of use, as the toolbar does on a board that could not be loaded. */
  disabled?: boolean;
}

export function PenToolbar({ color, thickness, onColor, onThickness, disabled = false }: PenToolbarProps): JSX.Element {
  /** A press on the panel is a command, not a board gesture: it must not draw or deselect. */
  const stop = (event: ReactPointerEvent<HTMLElement>): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label={PEN_TOOLBAR_LABEL}
      aria-disabled={disabled}
      onPointerDown={stop}
    >
      <div className="pen-toolbar__group" data-testid="pen-colors" role="group" aria-label="Pen colour">
        {(Object.keys(PEN_COLOR_LABELS) as PenColor[]).map((name) => (
          <button
            key={name}
            type="button"
            className="pen-toolbar__swatch"
            data-testid={`pen-color-${name}`}
            data-pen-color={name}
            aria-label={PEN_COLOR_LABELS[name]}
            title={PEN_COLOR_LABELS[name]}
            aria-pressed={color === name}
            disabled={disabled}
            style={{ backgroundColor: PEN_COLORS[name] }}
            onClick={() => {
              onColor(name);
            }}
          />
        ))}
      </div>
      <div className="pen-toolbar__group" data-testid="pen-thicknesses" role="group" aria-label="Pen thickness">
        {PEN_THICKNESS_ORDER.map((name) => (
          <button
            key={name}
            type="button"
            className="pen-toolbar__width"
            data-testid={`pen-thickness-${name}`}
            data-pen-thickness={name}
            aria-label={PEN_THICKNESS_LABELS[name]}
            title={`${PEN_THICKNESS_LABELS[name]} — ${PEN_THICKNESS_WORLD[name]} units wide`}
            aria-pressed={thickness === name}
            disabled={disabled}
            onClick={() => {
              onThickness(name);
            }}
          >
            {/* The dot is the nib: its diameter is the width the pen lays down, so the three buttons can be
                told apart by looking rather than by reading. */}
            <span
              className="pen-toolbar__nib"
              aria-hidden="true"
              style={{ width: PEN_THICKNESS_WORLD[name], height: PEN_THICKNESS_WORLD[name] }}
            />
            <span className="pen-toolbar__width-label">{PEN_THICKNESS_LABELS[name]}</span>
          </button>
        ))}
      </div>
      <span className="pen-toolbar__status" data-testid="pen-status" aria-live="polite">
        {penOptionSummary(color, thickness)}
      </span>
    </div>
  );
}
