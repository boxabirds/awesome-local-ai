// Pen options toolbar (visible while the Pen tool is active, next to the left
// toolbar): six colour swatches and Thin / Medium / Thick. The choice lives
// in usePenOptions session state and applies to subsequent strokes only.

import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

const COLOR_LABELS: Readonly<Record<PenColor, string>> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

const THICKNESS_LABELS: ReadonlyArray<{ thickness: PenThickness; label: string }> = [
  { thickness: 'thin', label: 'Thin' },
  { thickness: 'medium', label: 'Medium' },
  { thickness: 'thick', label: 'Thick' },
];

export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): React.JSX.Element {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="pen-swatches" data-testid="pen-swatches">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((key) => {
          const label = COLOR_LABELS[key];
          return (
            <button
              key={key}
              type="button"
              className="pen-swatch"
              data-testid={`pen-color-${key}`}
              aria-label={`${label} pen`}
              title={`${label} pen`}
              aria-pressed={key === color}
              style={{ background: PEN_COLORS[key] }}
              onClick={() => onColor(key)}
            />
          );
        })}
      </div>
      <div className="pen-thicknesses" data-testid="pen-thicknesses">
        {THICKNESS_LABELS.map(({ thickness: key, label }) => (
          <button
            key={key}
            type="button"
            className="pen-thickness-button"
            data-testid={`pen-thickness-${key}`}
            aria-label={label}
            title={label}
            aria-pressed={key === thickness}
            onClick={() => onThickness(key)}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 16,
                height: Math.max(1, Math.min(PEN_THICKNESS_WORLD[key], 8)),
                borderRadius: 4,
                background: '#1f2328',
                verticalAlign: 'middle',
                marginRight: 6,
              }}
            />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
