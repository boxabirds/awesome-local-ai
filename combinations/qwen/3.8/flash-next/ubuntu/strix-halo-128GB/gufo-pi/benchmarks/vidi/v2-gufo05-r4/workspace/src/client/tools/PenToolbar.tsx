/**
 * The pen toolbar: which ink, and how thick (`pen.options`).
 *
 * It appears while the Pen tool is held, next to the palette, and it is the only place a
 * stroke's colour is ever chosen. Two rules it has to keep:
 *
 *  - **the choice is a name, not a hex.** The swatches are the keys of `PEN_COLORS` and the
 *    buttons the keys of `PEN_THICKNESS_WORLD`, so what the toolbar presses and what the model
 *    stores are the same vocabulary — and a stroke drawn last week by a build that has since
 *    changed its palette still reads as *that* colour, or falls back to a default, rather than
 *    as a number nobody can interpret;
 *  - **it changes the next stroke and nothing else.** There is no write to the document here at
 *    all: the values live in `usePenOptions` for the length of the page, and a stroke already on
 *    the board keeps the colour and thickness it was drawn with until it is deleted.
 *
 * Unlike a note's or a shape's toolbar this one is not attached to an object — it belongs to the
 * tool, and it is there before there is anything to point at. So it sits in screen space beside
 * the palette rather than floating over a box, and it needs no counter-scaling by the zoom.
 */

import type { CSSProperties, JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenToolbarProps {
  /** The colour the next stroke will be drawn in, which is the pressed swatch. */
  color: PenColor;
  /** The thickness the next stroke will be drawn at, which is the pressed button. */
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
  /** False while the board cannot be written to (story 4): nothing here does anything. */
  disabled?: boolean;
}

/** The colours in the order they are offered: black first, because it is the default. */
const COLOR_ORDER = Object.keys(PEN_COLORS) as PenColor[];
/** The thicknesses, thin first. */
const THICKNESS_ORDER = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

/**
 * Capitalised for the accessible name: `black` in the palette is "Black" to a reader, `thick` is
 * "Thick". The same little rule serves both groups, which is why it is not called colour-only.
 */
function optionLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The swatch's ink, as a custom property, so the stylesheet never has to know the palette. */
const swatchStyle = (hex: string): CSSProperties => ({ ['--vidi6-swatch' as string]: hex } as CSSProperties);

/** Pointer and double-click events stop here: a click on a swatch is not a board gesture. */
const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

/**
 * A dot of the colour, for the swatch.
 *
 * A pen line is round, so the swatch is too — and a button that showed a stroke of the chosen
 * thickness would be a second way of saying what the thickness buttons next to it already say.
 */
function SwatchIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <circle cx="9" cy="9" r="6" fill="currentColor" />
    </svg>
  );
}

/** A stroke of this thickness, in screen pixels, so Thin and Thick look different. */
function ThicknessIcon({ thickness }: { thickness: PenThickness }): JSX.Element {
  const width = PEN_THICKNESS_WORLD[thickness];
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d="M3.5 13 C 7 6.5, 13 13.5, 16.5 7"
        fill="none"
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;
  const disabled = props.disabled === true;

  return (
    <div
      className="vidi6-pen-toolbar"
      data-vidi6="pen-toolbar"
      data-color={color}
      data-thickness={thickness}
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
    >
      {COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="vidi6-pen-swatch"
          data-vidi6="pen-swatch"
          data-color={name}
          aria-label={`${optionLabel(name)} pen`}
          title={`${optionLabel(name)} pen`}
          aria-pressed={name === color}
          aria-disabled={disabled}
          disabled={disabled}
          style={{ ...swatchStyle(PEN_COLORS[name]), color: PEN_COLORS[name] }}
          onClick={() => onColor(name)}
        >
          <SwatchIcon />
        </button>
      ))}
      <span className="vidi6-pen-toolbar-separator" aria-hidden="true" />
      {THICKNESS_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="vidi6-pen-thickness"
          data-vidi6="pen-thickness"
          data-thickness={name}
          aria-label={optionLabel(name)}
          title={`${optionLabel(name)} stroke`}
          aria-pressed={name === thickness}
          aria-disabled={disabled}
          disabled={disabled}
          onClick={() => onThickness(name)}
        >
          <ThicknessIcon thickness={name} />
        </button>
      ))}
    </div>
  );
}
