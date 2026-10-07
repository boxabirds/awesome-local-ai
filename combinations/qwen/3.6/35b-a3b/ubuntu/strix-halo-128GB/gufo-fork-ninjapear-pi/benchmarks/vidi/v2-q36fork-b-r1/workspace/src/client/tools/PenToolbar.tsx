import { PEN_COLORS } from '@/shared/config';
import type { PenColor, PenThickness } from '@/shared/config';
import { PEN_THICKNESS_WORLD } from '@/shared/config';

interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

export function PenToolbar(props: PenToolbarProps) {
  const { color, thickness, onColor, onThickness } = props;

  const colors = Object.keys(PEN_COLORS) as PenColor[];
  const thicknesses: PenThickness[] = ['thin', 'medium', 'thick'];
  const thicknessLabels: Record<PenThickness, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

  return (
    <div
      data-testid="pen-toolbar"
      style={{
        position: 'absolute',
        left: '48px',
        top: '8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        background: '#fff',
        borderRadius: '8px',
        padding: '8px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        zIndex: 100,
      }}
      role="toolbar"
      aria-label="Pen options"
    >
      {/* Color swatches */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {colors.map((c) => (
          <button
            key={c}
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
            title={`${c} pen`}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              backgroundColor: PEN_COLORS[c],
              border: color === c ? '2px solid #000' : '1px solid #ccc',
              cursor: 'pointer',
            }}
          />
        ))}
      </div>
      {/* Thickness buttons */}
      <div style={{ display: 'flex', gap: '4px' }}>
        {thicknesses.map((t) => (
          <button
            key={t}
            aria-label={thicknessLabels[t]}
            aria-pressed={thickness === t}
            onClick={() => onThickness(t)}
            title={thicknessLabels[t]}
            style={{
              padding: '2px 8px',
              border: thickness === t ? '2px solid #000' : '1px solid #ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            {thicknessLabels[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
