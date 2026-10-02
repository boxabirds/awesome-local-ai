import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_COLOR_LABELS,
  PEN_THICKNESS_LABELS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  /** The pen the next stroke will be drawn with: its swatch is the pressed one. */
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
  /** False only while the board cannot be edited: a pen that can draw nothing is
   *  shown unused rather than hidden, because the tool that cannot be used is still
   *  the tool the board is in. */
  disabled?: boolean;
}

/** The six colours, black first: it is what a new stroke is drawn with, and the
 *  order is the one the palette is written in. */
const COLOR_ORDER: readonly PenColor[] = ['black', 'blue', 'red', 'green', 'orange', 'purple'];

/** The three thicknesses, thin first: the same order as the settings, so the row
 *  reads in the order the numbers go. */
const THICKNESS_ORDER: readonly PenThickness[] = ['thin', 'medium', 'thick'];

/**
 * The pen's own choices: the six colours it can be dipped in and the three widths
 * it can be drawn at.
 *
 * It is part of the board toolbar and it belongs to the Pen tool rather than to any
 * stroke: the state it shows is this person's, held for this page, and choosing from
 * it writes nothing to the document at all. What is already drawn keeps the colour
 * and the width it was drawn with — that is stored in the stroke, which is the only
 * place a finished drawing's colour is ever kept.
 *
 * Every pointer event is stopped here. A press on a swatch that reached the viewport
 * would be read as the beginning of a stroke on the board, and a person choosing a
 * colour would find a line under their cursor.
 */
export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const stop = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
  };
  const disabled = props.disabled === true;

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
    >
      {COLOR_ORDER.map((color) => (
        <button
          key={color}
          type="button"
          className={`pen-swatch pen-color-swatch pen-color-swatch-${color}`}
          data-testid={`pen-color-${color}`}
          data-role="color"
          aria-label={`${PEN_COLOR_LABELS[color]} pen`}
          title={`${PEN_COLOR_LABELS[color]} pen – the next stroke is drawn in this colour`}
          aria-disabled={disabled ? 'true' : undefined}
          disabled={disabled}
          aria-pressed={color === props.color}
          style={{ backgroundColor: PEN_COLORS[color] }}
          onClick={() => {
            props.onColor(color);
          }}
        />
      ))}
      <span className="pen-toolbar-sep" aria-hidden="true" />
      {THICKNESS_ORDER.map((thickness) => (
        <button
          key={thickness}
          type="button"
          className={`pen-swatch pen-thickness-swatch pen-thickness-swatch-${thickness}`}
          data-testid={`pen-thickness-${thickness}`}
          data-role="thickness"
          aria-label={PEN_THICKNESS_LABELS[thickness]}
          title={`${PEN_THICKNESS_LABELS[thickness]} – ${PEN_THICKNESS_WORLD[thickness]} board units wide`}
          aria-disabled={disabled ? 'true' : undefined}
          disabled={disabled}
          aria-pressed={thickness === props.thickness}
          onClick={() => {
            props.onThickness(thickness);
          }}
        >
          <span
            className="pen-thickness-bar"
            aria-hidden="true"
            style={{ height: `${PEN_THICKNESS_WORLD[thickness]}px` }}
          />
        </button>
      ))}
    </div>
  );
}
