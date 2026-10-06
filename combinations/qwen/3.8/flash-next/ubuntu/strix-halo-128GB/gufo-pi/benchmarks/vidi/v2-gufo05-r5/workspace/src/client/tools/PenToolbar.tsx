/**
 * The pen's bar of colours and thicknesses (story 11).
 *
 * It shows while the Pen is armed, because the choice is about the *next* stroke and not about one
 * that has already been drawn: a finished stroke keeps the colour and thickness it was drawn with, and
 * nothing here restyles it. Like the note's and the shape's bars it uses named buttons rather than
 * coloured squares alone - "blue pen" and "thick pen" say what a button means in words, which is the
 * one thing a swatch cannot show by itself.
 *
 * The bar sits above the pen's own surface so that pressing a swatch is a press on the bar: it neither
 * starts a stroke nor reaches the board underneath.
 */
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenToolbarProps {
  /** The colour the next stroke will be drawn in, shown as pressed. */
  color: PenColor;
  /** The thickness the next stroke will be drawn with, shown as pressed. */
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

/** "blue pen", "red pen": the colour said out loud, the way the other bars say theirs. */
export function penColorLabel(color: PenColor): string {
  return `${color} pen`;
}

/** "Thin", "Medium", "Thick" - the words the PRD uses for the three thicknesses. */
export function penThicknessLabel(thickness: PenThickness): string {
  return thickness.charAt(0).toUpperCase() + thickness.slice(1);
}

function stopPropagation(event: ReactPointerEvent | ReactMouseEvent): void {
  // a press on the bar is not a press on the board, and above all not the start of a stroke
  event.stopPropagation();
}

export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): JSX.Element {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen"
      onPointerDown={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      {(Object.keys(PEN_COLORS) as PenColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="pen-toolbar__swatch"
          data-pen-color={name}
          style={{ background: PEN_COLORS[name] }}
          aria-label={penColorLabel(name)}
          title={penColorLabel(name)}
          aria-pressed={color === name}
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <span className="pen-toolbar__divider" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
        <button
          key={name}
          type="button"
          className="pen-toolbar__thickness"
          data-pen-thickness={name}
          aria-label={penThicknessLabel(name)}
          title={`${penThicknessLabel(name)} (${PEN_THICKNESS_WORLD[name]} px)`}
          aria-pressed={thickness === name}
          onClick={() => {
            onThickness(name);
          }}
        >
          <span
            className="pen-toolbar__thickness-mark"
            style={{ height: Math.max(2, PEN_THICKNESS_WORLD[name] / 2) }}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
