// Pen toolbar (story 11): six colour swatches and Thin / Medium / Thick, shown next to the left
// toolbar while the Pen tool is active. Choices apply to later strokes only.
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export const PEN_THICKNESS_NAMES: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}) {
  return (
    <div className="toolbar-menu pen-toolbar" role="group" aria-label="Pen options">
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="toolbar-button pen-swatch"
          aria-label={`${c} pen`}
          title={`${c[0].toUpperCase()}${c.slice(1)} pen`}
          aria-pressed={props.color === c}
          onClick={() => props.onColor(c)}
        >
          <span className="pen-swatch-dot" style={{ background: PEN_COLORS[c] }} aria-hidden="true" />
        </button>
      ))}
      <span className="toolbar-separator" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
        <button
          key={t}
          type="button"
          className="toolbar-button pen-thickness"
          aria-label={PEN_THICKNESS_NAMES[t]}
          title={PEN_THICKNESS_NAMES[t]}
          aria-pressed={props.thickness === t}
          onClick={() => props.onThickness(t)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <line
              x1="5"
              y1="12"
              x2="19"
              y2="12"
              stroke="currentColor"
              strokeWidth={PEN_THICKNESS_WORLD[t] / 1.5 + 0.5}
              strokeLinecap="round"
            />
          </svg>
        </button>
      ))}
    </div>
  );
}
