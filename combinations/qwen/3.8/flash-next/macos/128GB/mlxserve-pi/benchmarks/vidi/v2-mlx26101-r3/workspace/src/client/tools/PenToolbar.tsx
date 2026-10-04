import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/** What each of the six colours is called on the screen. */
const COLOR_LABELS: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

/** What each of the three widths is called on the screen. */
const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/**
 * How thick the little sample line inside each width button is drawn, in screen pixels.
 *
 * Not the widths themselves: `thin` is two board units, which at the zoom a board happens to be at is
 * either a hair or a band, and a button whose sample changes size when the board is zoomed is a button
 * that cannot be compared with the button next to it. These three numbers are the ratios of 2, 4 and 8,
 * made big enough that the middle and the thick one are visibly different at any zoom.
 */
const THICKNESS_PX: Record<PenThickness, number> = { thin: 2, medium: 4, thick: 7 };

export interface PenToolbarProps {
  /** Which colour is selected now; the swatch that is drawn pressed. */
  color: PenColor;
  /** Which width is selected now. */
  thickness: PenThickness;
  /** Draw the next strokes in this colour. */
  onColor(color: PenColor): void;
  /** Draw the next strokes at this width. */
  onThickness(thickness: PenThickness): void;
}

/**
 * The pen's two choices, in a bar next to the toolbar it belongs to (story 11).
 *
 * Six swatches and three widths, and nothing else: the pen has no other settings, and a person who
 * wants to know what they are about to draw with can be answered by looking at the bar rather than by
 * drawing a stroke and seeing.
 *
 * Both groups show the current choice as pressed, which is the same rule the tools on the main toolbar
 * follow and for the same reason: the choice is not a fact about the board, it is a fact about the next
 * stroke, and the only place that can be shown is here. Changing either one changes nothing that is
 * already drawn - a stroke keeps the colour and width it was drawn with, in its own object, forever.
 *
 * It carries `data-board-ui`, so a press on a swatch never starts a stroke and a wheel over the bar
 * never zooms the board - and, because {@link PenTool} declines presses on board UI, the bar is the one
 * place the pen's own pointer handler stands down.
 */
export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  return (
    <div
      className="pen-toolbar"
      data-board-ui=""
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      <span className="pen-toolbar__colors" data-testid="pen-colors" role="group" aria-label="Pen colour">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((name) => (
          <button
            key={name}
            type="button"
            className="pen-toolbar__color"
            data-testid={`pen-color-${name}`}
            data-color={name}
            aria-label={`${COLOR_LABELS[name]} pen`}
            title={`${COLOR_LABELS[name]} \u2013 the next stroke is drawn in this colour`}
            aria-pressed={color === name}
            style={{ background: PEN_COLORS[name] }}
            onClick={() => {
              onColor(name);
            }}
          />
        ))}
      </span>
      <span
        className="pen-toolbar__thicknesses"
        data-testid="pen-thicknesses"
        role="group"
        aria-label="Pen thickness"
      >
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
          <button
            key={name}
            type="button"
            className="pen-toolbar__thickness"
            data-testid={`pen-thickness-${name}`}
            data-thickness={name}
            aria-label={THICKNESS_LABELS[name]}
            title={`${THICKNESS_LABELS[name]} \u2013 ${PEN_THICKNESS_WORLD[name]} board units wide`}
            aria-pressed={thickness === name}
            onClick={() => {
              onThickness(name);
            }}
          >
            <span
              className="pen-toolbar__sample"
              style={{ height: `${THICKNESS_PX[name]}px` }}
              aria-hidden="true"
            />
            <span className="pen-toolbar__sample-label">{THICKNESS_LABELS[name]}</span>
          </button>
        ))}
      </span>
    </div>
  );
}