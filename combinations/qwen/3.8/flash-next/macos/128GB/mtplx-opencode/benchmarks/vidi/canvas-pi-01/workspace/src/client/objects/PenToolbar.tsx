/**
 * Story 11 · task 15 — the pen options (design "Pen tool and options").
 *
 * One row of six colour swatches and three width buttons, used in two places:
 * beside the Pen tool (the options the *next* sketch will use) and beside a
 * selected stroke (restyling the one drawing). The same six names and the same
 * accessible names appear in both, so nothing here is bound to a particular
 * board object.
 *
 * A button's `aria-pressed` state is the only thing that tells a screen-reader
 * user which ink is current, so the row is never colour-only, and pointer events
 * are stopped so a click here cannot fall through to the board underneath.
 */
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

export interface PenToolbarProps {
  /** The ink currently chosen. */
  color: string;
  /** The width currently chosen. */
  thickness: string;
  onColor?(color: PenColor): void;
  onThickness?(thickness: PenThickness): void;
  /** Test / accessible hook: "pen-toolbar" for the tool row, "stroke-toolbar" for a stroke. */
  testId?: string;
}

/** Capitalised token, used for the accessible name of each control. */
const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** The six inks, in the order the row lists them. */
export const PEN_COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];

/** The three widths, thin first. */
export const PEN_THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

/** The drawn width of an option button's sample line, in screen px. */
const WIDTH_PREVIEW_PX: Record<string, number> = { thin: 2, medium: 4, thick: 8 };

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;
  const stop = (event: ReactPointerEvent) => event.stopPropagation();

  return (
    <div
      className="pen-toolbar"
      data-testid={props.testId ?? 'pen-toolbar'}
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stop}
    >
      <div className="pen-swatches" data-testid="pen-colors">
        {PEN_COLOR_NAMES.map((name) => (
          <button
            key={`pen-color-${name}`}
            type="button"
            className="swatch pen-swatch"
            data-testid={`pen-color-${name}`}
            data-color={name}
            aria-label={`${label(name)} pen`}
            aria-pressed={color === name}
            style={{ backgroundColor: PEN_COLORS[name] }}
            onPointerDown={stop}
            onClick={(event) => {
              event.stopPropagation();
              onColor?.(name);
            }}
          />
        ))}
      </div>
      <div className="pen-widths" data-testid="pen-widths">
        {PEN_THICKNESS_NAMES.map((name) => (
          <button
            key={`pen-width-${name}`}
            type="button"
            className="pen-width-button"
            data-testid={`pen-width-${name}`}
            data-width={name}
            aria-label={label(name)}
            aria-pressed={thickness === name}
            onPointerDown={stop}
            onClick={(event) => {
              event.stopPropagation();
              onThickness?.(name);
            }}
          >
            <span
              aria-hidden="true"
              className="pen-width-sample"
              style={{ height: `${WIDTH_PREVIEW_PX[name] ?? PEN_THICKNESS_WORLD[name]}px` }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
