// The Pen tool's own toolbar (story 11): the six colours and the three thicknesses
// the next stroke is drawn with, in a small panel beside the tool rail.
//
// It is the Shape tool's kind menu in another shape: the choice is made on the way
// to drawing, so it is shown while the Pen is held and gone the moment another tool
// is, rather than buried in a dialog. Six swatches and three dots, no words - the
// swatch is the colour and the dot is the thickness, and both are drawn at the size
// they really are.
//
// Nothing here is remembered beyond this visit: the choice is React state held by the
// board (usePenOptions), never written to the document, so nobody else sees it and a
// reload brings the defaults back. A press on this panel is a click on UI: it must
// not draw a stroke on the panel, pan the board or clear the selection, which is what
// the stopped pointer events are for.

import type { CSSProperties, JSX } from 'react';
import {
  PEN_COLORS,
  PEN_COLOR_KEYS,
  PEN_THICKNESS_KEYS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  /** The colour the next stroke is drawn in: the swatch shown as pressed. */
  color: PenColor;
  /** The thickness the next stroke is drawn with: the dot shown as pressed. */
  thickness: PenThickness;
  /** The next stroke is drawn in this colour; nothing already drawn changes. */
  onColor(color: PenColor): void;
  /** The next stroke is drawn with this thickness; nothing already drawn changes. */
  onThickness(thickness: PenThickness): void;
}

/** What each colour's button is called: the swatch's own name, then the tool. */
const COLOR_NAMES: Readonly<Record<PenColor, string>> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

/** What each thickness's button is called. */
const THICKNESS_NAMES: Readonly<Record<PenThickness, string>> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): JSX.Element {
  return (
    <div
      className="pen-options"
      data-testid="pen-toolbar"
      data-pen-color={color}
      data-pen-thickness={thickness}
      role="toolbar"
      aria-label="Pen tools"
      // The panel is UI: a press on it draws no stroke, pans no board and clears no
      // selection - the same rule the tool rail holds to.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {PEN_COLOR_KEYS.map((name) => (
        <button
          key={name}
          type="button"
          className="pen-swatch"
          data-testid={`pen-color-${name}`}
          aria-label={`${COLOR_NAMES[name]} pen`}
          // the colour the next stroke is drawn in is the pressed one
          aria-pressed={color === name}
          title={`${COLOR_NAMES[name]} – the next stroke is drawn in this colour`}
          style={{ '--pen-swatch': PEN_COLORS[name] } as CSSProperties}
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <span className="pen-options__divider" aria-hidden="true" />
      {PEN_THICKNESS_KEYS.map((name) => (
        <button
          key={name}
          type="button"
          className="pen-thickness"
          data-testid={`pen-thickness-${name}`}
          aria-label={THICKNESS_NAMES[name]}
          aria-pressed={thickness === name}
          title={`${THICKNESS_NAMES[name]} – ${PEN_THICKNESS_WORLD[name]} px at 100% zoom`}
          onClick={() => {
            onThickness(name);
          }}
        >
          {/* The dot is drawn at the thickness it means, in screen pixels: the panel
              is fixed UI, so 4 px here is 4 board units at 100% zoom. */}
          <span
            className="pen-thickness__dot"
            data-testid={`pen-thickness-${name}-dot`}
            style={{ width: `${PEN_THICKNESS_WORLD[name]}px`, height: `${PEN_THICKNESS_WORLD[name]}px` }}
          />
        </button>
      ))}
    </div>
  );
}
