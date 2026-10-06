/**
 * The pen's two rows of buttons: which colour, and how thick (story 11).
 *
 * Shown while the Pen is the tool — the same deal the Shape tool's row of three kinds has, for the same
 * reason: "which pen" is a question that means nothing to somebody who is drawing an arrow, and a permanent
 * row of nine would be nine buttons competing for the person who is trying to sketch.
 *
 * Both rows show the choice as it stands, which is the only way a person can know what the next stroke will
 * look like before they draw it; both rows write to the session state and to nothing else (see
 * `usePenOptions`). The buttons are a *choice about the future* and not a control over the past — click red
 * with a blue circle on the board and the circle stays blue, because its colour is in the object and these
 * buttons are the pen, not a paint bucket.
 *
 * The colour buttons are drawn from `PEN_COLORS` and the thickness buttons from `PEN_THICKNESS_WORLD`, so
 * there is exactly one list of what a pen can be and this file is a rendering of it. A colour added to the
 * palette appears here in its place; a colour added here without being added there is a button that writes
 * a stroke the model refuses, which is the failure mode the shape toolbar's equivalent is written against.
 */

import {
  PEN_COLOR_NAMES,
  PEN_COLORS,
  PEN_THICKNESS_NAMES,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';
import { strokeColorOf } from '../../shared/objects/stroke';

/** What a swatch button says out loud: the colour, and that it is a pen. */
export const penColorLabel = (color: PenColor): string => `${color} pen`;

/** What a thickness button says out loud: the word on the button, capitalised. */
export const penThicknessLabel = (thickness: PenThickness): string =>
  thickness.charAt(0).toUpperCase() + thickness.slice(1);

export interface PenToolbarProps {
  /** The colour the next stroke is drawn in, which is the swatch that is lit. */
  color: PenColor;
  /** The thickness the next stroke is drawn with, which is the button that is lit. */
  thickness: PenThickness;
  /** Draws the next stroke in this colour. */
  onColor(color: PenColor): void;
  /** Draws the next stroke at this thickness. */
  onThickness(thickness: PenThickness): void;
}

/**
 * The two rows.
 *
 * One `role=\"toolbar\"` around both, because they are one instrument: a person tabbing to the pen's settings
 * expects to find them together and to leave them together, and a screen reader announcing two unnamed
 * groups of buttons is two groups to have to work out the relationship between.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): React.JSX.Element {
  return (
    <div
      aria-label="Pen options"
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
    >
      <div aria-label="Pen colour" className="pen-colors" data-testid="pen-colors" role="group">
        {PEN_COLOR_NAMES.map((name) => (
          <button
            aria-label={penColorLabel(name)}
            aria-pressed={color === name}
            className="pen-swatch"
            data-color={name}
            data-testid={`pen-color-${name}`}
            key={name}
            title={penColorLabel(name)}
            type="button"
            onClick={() => onColor(name)}
            // The swatch is the colour it names, from the same object the strokes are drawn in: a button
            // whose paint came from a second list would be a button that could be lying about the colour it
            // offers, in a shade nobody can read off the screen.
            style={{ background: strokeColorOf(name) } as React.CSSProperties}
          />
        ))}
      </div>
      <div aria-label="Pen thickness" className="pen-thicknesses" data-testid="pen-thicknesses" role="group">
        {PEN_THICKNESS_NAMES.map((name) => (
          <button
            aria-label={penThicknessLabel(name)}
            aria-pressed={thickness === name}
            className="pen-thickness"
            data-testid={`pen-thickness-${name}`}
            data-width={PEN_THICKNESS_WORLD[name]}
            key={name}
            title={penThicknessLabel(name)}
            type="button"
            onClick={() => onThickness(name)}
          >
            {penThicknessLabel(name)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The palette, for a test or a story that wants to know what the buttons were drawn from. */
export const PEN_SWATCH_COLORS = PEN_COLORS;
