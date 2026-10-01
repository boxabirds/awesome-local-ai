import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/config';

const THICKNESS_LABELS: Record<PenThickness, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

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
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="pen-colors" role="group" aria-label="Pen colour">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-label={`${c} pen`}
            title={`${c} pen`}
            aria-pressed={props.color === c}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className="pen-thickness" role="group" aria-label="Pen thickness">
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            className="pen-thickness-button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
          >
            <span className="pen-thickness-line" style={{ height: PEN_THICKNESS_WORLD[t] }} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
