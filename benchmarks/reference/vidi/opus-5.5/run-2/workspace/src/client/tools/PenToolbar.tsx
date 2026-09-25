/**
 * The pen toolbar next to the left toolbar while the Pen is active (anchor: pen.options):
 * six colour swatches ("Black pen" ... "Purple pen") and Thin / Medium / Thick, each a
 * toggle button showing the current choice. Pointer and wheel input never reach the board.
 */
import type { SyntheticEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export const PEN_COLOR_NAMES: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

export const PEN_THICKNESS_NAMES: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** "Red pen". */
export function penColorLabel(c: PenColor): string {
  return `${PEN_COLOR_NAMES[c]} pen`;
}

const COLOR_ORDER = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESS_ORDER = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
/** Largest preview line in a thickness button, in CSS pixels. */
const PREVIEW_MAX_PX = 8;

export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}): React.JSX.Element {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="pen-toolbar"
      role="toolbar"
      aria-label="Pen"
      aria-orientation="vertical"
      data-testid="pen-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      <div className="pen-colors">
        {COLOR_ORDER.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-label={penColorLabel(c)}
            title={penColorLabel(c)}
            aria-pressed={props.color === c}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className="pen-thicknesses">
        {THICKNESS_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            aria-label={PEN_THICKNESS_NAMES[t]}
            title={PEN_THICKNESS_NAMES[t]}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <line
                x1="5"
                y1="12"
                x2="19"
                y2="12"
                stroke={PEN_COLORS[props.color]}
                strokeWidth={Math.min(PEN_THICKNESS_WORLD[t], PREVIEW_MAX_PX)}
                strokeLinecap="round"
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
