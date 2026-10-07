import type { JSX } from 'react';

import {
  PEN_COLOR_LIST,
  PEN_COLOR_NAMES,
  PEN_COLORS,
  PEN_THICKNESS_LIST,
  PEN_THICKNESS_NAMES,
  type PenColor,
  type PenThickness,
} from '../../shared/config.js';

/**
 * The ink and the pen, while the pen is the tool (`src/client/tools/PenToolbar.tsx`,
 * `pen.options`).
 *
 * Six swatches and three widths, in a bar that exists only while the Pen tool is up -
 * which is the same rule every other option in this app follows: the controls for a
 * tool are shown by the tool, not by the board. A person who presses `P` should not
 * have to look for the settings of a tool they are already holding, and a person who
 * never presses `P` should never have to wonder what nine small buttons along the top
 * of their screen were for.
 *
 * What this bar does *not* do is the half of the requirement that matters most: it
 * never restyles a stroke that is already on the board (`pen.options` - "changing
 * options does not restyle existing strokes"). There is no selection here, no object
 * id, no document: the bar hands back two names, and the only thing that reads them is
 * the pen that draws the next line. Choosing a colour cannot find anything to change,
 * because nothing in this file is looking for something to change.
 *
 * The settings are not saved anywhere either (`pen.options.defaults`): see
 * `usePenOptions.ts` for why a pen remembered from yesterday is not a pen chosen today.
 */

export interface PenToolbarProps {
  /** The ink and pen the next stroke will be drawn with. */
  color: PenColor;
  thickness: PenThickness;
  /** Draw the next stroke in this ink. */
  onColor(color: PenColor): void;
  /** Draw the next stroke with this pen. */
  onThickness(thickness: PenThickness): void;
}

/** A swatch button: the colour is the label, so the button is the colour. */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): JSX.Element {
  return (
    <div
      className="pen-options"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      // The bar is chrome, not board: a press on a swatch must neither draw a stroke
      // under it nor pan the board behind it. The bar is beside the viewport rather
      // than inside it, so there is nothing to stop propagating to.
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <span className="pen-options-group" data-testid="pen-colors" role="group" aria-label="Pen colour">
        {PEN_COLOR_LIST.map((name: PenColor) => (
          <button
            key={name}
            type="button"
            className="pen-swatch"
            data-testid="pen-color-button"
            data-color={name}
            aria-label={`${PEN_COLOR_NAMES[name]} pen`}
            // The tooltip says what it is in the sentence a person is thinking, which
            // is "draw with this", not "change that".
            title={`Draw in ${PEN_COLOR_NAMES[name]}`}
            aria-pressed={color === name ? 'true' : 'false'}
            style={{ ['--pen-ink' as string]: PEN_COLORS[name] }}
            onClick={() => onColor(name)}
          />
        ))}
      </span>
      <span className="pen-options-group" data-testid="pen-thicknesses" role="group" aria-label="Pen thickness">
        {PEN_THICKNESS_LIST.map((name: PenThickness) => (
          <button
            key={name}
            type="button"
            className="pen-width"
            data-testid="pen-thickness-button"
            data-thickness={name}
            aria-label={PEN_THICKNESS_NAMES[name]}
            title={`Draw with a ${PEN_THICKNESS_NAMES[name].toLowerCase()} line`}
            aria-pressed={thickness === name ? 'true' : 'false'}
            onClick={() => onThickness(name)}
          >
            {PEN_THICKNESS_NAMES[name]}
          </button>
        ))}
      </span>
    </div>
  );
}

export default PenToolbar;
