import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

const THICKNESS_LABELS: { value: PenThickness; label: string }[] = [
  { value: 'thin', label: 'Thin' },
  { value: 'medium', label: 'Medium' },
  { value: 'thick', label: 'Thick' },
];

/** Colours and thickness of the Pen tool; rendered next to the left toolbar while Pen is active. */
export function PenToolbar(props: {
  color: PenColor; thickness: PenThickness; onColor(c: PenColor): void; onThickness(t: PenThickness): void;
}) {
  return (
    <div className="pen-toolbar" role="toolbar" aria-label="Pen options" onPointerDown={(e) => e.stopPropagation()}>
      <div className="pen-swatches">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="pen-swatch"
            aria-label={`${c} pen`}
            title={`${c} pen`}
            aria-pressed={props.color === c}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className="pen-thickness">
        {THICKNESS_LABELS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="pen-thickness-button"
            aria-label={label}
            title={label}
            aria-pressed={props.thickness === value}
            onClick={() => props.onThickness(value)}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeLinecap="round" strokeWidth={PEN_THICKNESS_WORLD[value]} />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
