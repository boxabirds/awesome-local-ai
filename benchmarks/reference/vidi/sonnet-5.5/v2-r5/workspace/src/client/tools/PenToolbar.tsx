import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

const COLORS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESSES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
const LABELS: Record<PenThickness, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

export function PenToolbar(props: {
  color: PenColor; thickness: PenThickness; onColor(c: PenColor): void; onThickness(t: PenThickness): void;
}) {
  return (
    <div className="pen-toolbar" role="toolbar" aria-label="Pen options" onPointerDown={(e) => e.stopPropagation()}>
      <div className="swatch-group" role="group" aria-label="Pen colour">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch pen-swatch"
            aria-label={`${c} pen`}
            title={`${c} pen`}
            aria-pressed={props.color === c}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className="swatch-group" role="group" aria-label="Pen thickness">
        {THICKNESSES.map((t) => (
          <button
            key={t}
            type="button"
            className="pen-thickness"
            aria-label={LABELS[t]}
            title={LABELS[t]}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
          >
            <span className="pen-thickness-bar" style={{ height: PEN_THICKNESS_WORLD[t] }} />
          </button>
        ))}
      </div>
    </div>
  );
}
