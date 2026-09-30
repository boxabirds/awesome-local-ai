import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

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
 * Pen options (story 11, pen.options), shown next to the left toolbar while the
 * Pen is active: six colour swatches and Thin / Medium / Thick. Choices apply
 * to the next strokes only; strokes already drawn keep their own.
 */
export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}) {
  return (
    <div className="pen-toolbar" role="toolbar" aria-label="Pen">
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="pen-swatch"
          aria-label={`${PEN_COLOR_NAMES[c]} pen`}
          title={`${PEN_COLOR_NAMES[c]} pen`}
          aria-pressed={props.color === c}
          onClick={() => props.onColor(c)}
        >
          <span className="pen-swatch-dot" style={{ background: PEN_COLORS[c] }} aria-hidden="true" />
        </button>
      ))}
      <span className="pen-toolbar-separator" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
        <button
          key={t}
          type="button"
          className="pen-thickness"
          aria-label={PEN_THICKNESS_NAMES[t]}
          title={PEN_THICKNESS_NAMES[t]}
          aria-pressed={props.thickness === t}
          onClick={() => props.onThickness(t)}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" focusable="false">
            <path d="M4 11h14" stroke="currentColor" strokeWidth={PEN_THICKNESS_WORLD[t]} strokeLinecap="round" />
          </svg>
        </button>
      ))}
    </div>
  );
}
