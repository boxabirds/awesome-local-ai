import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/**
 * The pen toolbar (`pen.options`): the six colours and three thicknesses the next stroke is
 * drawn with, shown while the Pen tool is up.
 *
 * It sits next to the left toolbar rather than inside it, because everything on it is about
 * the tool in hand — the same reason the Shape tool carries its kind menu — and it disappears
 * with the tool. Nothing here knows about any stroke that already exists: the choices apply to
 * what comes next, and a finished stroke keeps the colour and thickness it was drawn with
 * (PRD: "THE SYSTEM SHALL NOT change strokes already drawn").
 */

/** What each colour is called in its swatch's label, exactly as the PRD's palette reads. */
export const PEN_COLOUR_NAMES = {
  black: 'black',
  blue: 'blue',
  red: 'red',
  green: 'green',
  orange: 'orange',
  purple: 'purple',
} as const satisfies Record<PenColor, string>;

/** `aria-label` of a colour swatch: "black pen", "red pen". */
export function penSwatchLabel(colour: PenColor): string {
  return `${PEN_COLOUR_NAMES[colour]} pen`;
}

/** What the three thickness buttons say, in the order the settings list them. */
export const PEN_THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export const PEN_COLOUR_GROUP_LABEL = 'Pen colour';
export const PEN_THICKNESS_GROUP_LABEL = 'Pen thickness';

export interface PenToolbarProps {
  /** The colour the next stroke will be drawn in. */
  color: PenColor;
  /** The thickness the next stroke will be drawn at. */
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    // A press on a swatch belongs to the swatch: the board under the toolbar neither pans nor
    // loses the selection.
    event.stopPropagation();
  };
  return (
    <div
      className="vidi6-pen-toolbar"
      data-testid="pen-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div
        className="vidi6-pen-swatches"
        data-testid="pen-colours"
        role="group"
        aria-label={PEN_COLOUR_GROUP_LABEL}
      >
        {(Object.keys(PEN_COLORS) as PenColor[]).map((colour) => (
          <button
            key={colour}
            type="button"
            className="vidi6-pen-swatch"
            data-testid={`pen-colour-${colour}`}
            data-pen-colour={colour}
            aria-label={penSwatchLabel(colour)}
            title={`${PEN_COLOUR_NAMES[colour]} pen`}
            aria-pressed={color === colour}
            style={{ backgroundColor: PEN_COLORS[colour] }}
            onClick={() => onColor(colour)}
          />
        ))}
      </div>
      <div
        className="vidi6-pen-thicknesses"
        data-testid="pen-thicknesses"
        role="group"
        aria-label={PEN_THICKNESS_GROUP_LABEL}
      >
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
          <button
            key={name}
            type="button"
            className="vidi6-pen-thickness"
            data-testid={`pen-thickness-${name}`}
            data-pen-thickness={name}
            aria-label={PEN_THICKNESS_LABELS[name]}
            title={`${PEN_THICKNESS_LABELS[name]} pen`}
            aria-pressed={thickness === name}
            onClick={() => onThickness(name)}
          >
            <span
              className="vidi6-pen-thickness-glyph"
              aria-hidden="true"
              style={{ height: `${PEN_THICKNESS_WORLD[name]}px` }}
            />
            <span className="vidi6-pen-thickness-text">{PEN_THICKNESS_LABELS[name]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
