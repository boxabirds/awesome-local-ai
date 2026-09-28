import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/**
 * Pen toolbar: six colour swatches and three thickness buttons.
 * Visible only while Pen tool is active.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      style={{
        position: 'fixed',
        left: 60,
        top: 80,
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1001,
      }}
    >
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: color === c ? '2px solid #1976D2' : '2px solid transparent',
              background: PEN_COLORS[c],
              cursor: 'pointer',
            }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: thickness === t ? '2px solid #1976D2' : '1px solid #ccc',
              background: thickness === t ? '#E3F2FD' : '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
            onClick={() => onThickness(t)}
          >
            {THICKNESS_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
