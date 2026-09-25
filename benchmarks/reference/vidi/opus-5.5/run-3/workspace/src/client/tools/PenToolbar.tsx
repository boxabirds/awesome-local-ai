import type { CSSProperties, SyntheticEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export const PEN_THICKNESS_NAMES: Record<PenThickness, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * The pen toolbar next to the left toolbar while the Pen is active (pen.options): six colour swatches
 * ("black pen", ...) and Thin / Medium / Thick, each showing its state with aria-pressed.
 */
export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}) {
  return (
    <div
      className="pen-toolbar"
      role="toolbar"
      aria-label="Pen"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="pen-toolbar__swatch"
          aria-label={`${c} pen`}
          title={c[0].toUpperCase() + c.slice(1)}
          aria-pressed={props.color === c}
          style={{ '--swatch': PEN_COLORS[c] } as CSSProperties}
          onClick={() => props.onColor(c)}
        />
      ))}
      <div className="pen-toolbar__divider" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
        <button
          key={t}
          type="button"
          className="pen-toolbar__thickness"
          aria-label={PEN_THICKNESS_NAMES[t]}
          title={PEN_THICKNESS_NAMES[t]}
          aria-pressed={props.thickness === t}
          onClick={() => props.onThickness(t)}
        >
          <span
            className="pen-toolbar__line"
            style={{ height: PEN_THICKNESS_WORLD[t], background: PEN_COLORS[props.color] }}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
