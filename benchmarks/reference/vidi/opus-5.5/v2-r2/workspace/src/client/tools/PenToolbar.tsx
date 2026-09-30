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

/**
 * The pen toolbar (pen.options), shown next to the left toolbar while the Pen
 * is active: six colour swatches and Thin / Medium / Thick. Choices only
 * affect strokes drawn afterwards.
 */
export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}): React.JSX.Element {
  return (
    <div
      className="pen-toolbar"
      role="toolbar"
      aria-label="Pen"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="pen-swatch"
          aria-label={`${PEN_COLOR_NAMES[c]} pen`}
          title={`${PEN_COLOR_NAMES[c]} pen`}
          aria-pressed={props.color === c}
          data-color={c}
          style={{ backgroundColor: PEN_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <span className="pen-toolbar-divider" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
        <button
          key={t}
          type="button"
          className="pen-thickness"
          aria-label={PEN_THICKNESS_NAMES[t]}
          title={PEN_THICKNESS_NAMES[t]}
          aria-pressed={props.thickness === t}
          data-thickness={t}
          onClick={() => props.onThickness(t)}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
            <path
              d="M5 15c3-5 6-5 8-2s4 3 6-2"
              fill="none"
              stroke="currentColor"
              strokeWidth={PEN_THICKNESS_WORLD[t] * 0.75}
              strokeLinecap="round"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
