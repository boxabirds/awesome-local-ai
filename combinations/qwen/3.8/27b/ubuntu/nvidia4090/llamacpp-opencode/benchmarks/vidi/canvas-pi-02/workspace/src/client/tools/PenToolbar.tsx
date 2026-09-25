import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';

/**
 * Pen options toolbar (story 11, pen.tool): six colour swatches
 * (`aria-label="<colour> pen"`, aria-pressed on the active one) and three
 * thickness buttons (`aria-label="Thin" | "Medium" | "Thick"`). Rendered next
 * to the left board toolbar only while the Pen tool is active.
 *
 * The container stops pointer propagation so clicks here never reach the
 * viewport (the toolbar floats above it).
 */

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor: (c: PenColor) => void;
  onThickness: (t: PenThickness) => void;
}

const STOP = (e: { stopPropagation(): void }): void => {
  e.stopPropagation();
};

const COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): JSX.Element {
  return (
    <div
      className="vidi6-pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={STOP}
      onPointerUp={STOP}
      onPointerCancel={STOP}
      onDoubleClick={STOP}
      onClick={STOP}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          type="button"
          data-testid={`pen-color-${c}`}
          className={`vidi6-pen-toolbar__swatch${color === c ? ' vidi6-pen-toolbar__swatch--active' : ''}`}
          style={{ background: PEN_COLORS[c] }}
          aria-label={`${c} pen`}
          aria-pressed={color === c}
          title={`${capitalize(c)} pen`}
          onClick={() => onColor(c)}
        />
      ))}
      {THICKNESS_NAMES.map((t) => (
        <button
          key={t}
          type="button"
          data-testid={`pen-thickness-${t}`}
          className={`vidi6-pen-toolbar__thickness${thickness === t ? ' vidi6-pen-toolbar__thickness--active' : ''}`}
          aria-label={capitalize(t)}
          aria-pressed={thickness === t}
          title={`${capitalize(t)} thickness`}
          onClick={() => onThickness(t)}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 18,
              height: PEN_THICKNESS_WORLD[t] * 1.25,
              borderRadius: 999,
              background: '#212121',
            }}
          />
        </button>
      ))}
    </div>
  );
}
