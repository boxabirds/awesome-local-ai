/**
 * PenToolbar: six colour swatches and three thickness buttons for the Pen tool.
 * Visible only while the Pen tool is active.
 */
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const COLOR_LABELS: Record<PenColor, string> = {
  black: 'black pen',
  blue: 'blue pen',
  red: 'red pen',
  green: 'green pen',
  orange: 'orange pen',
  purple: 'purple pen',
};

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): React.JSX.Element {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      style={{
        position: 'absolute',
        left: 60,
        top: 8,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Colour swatches */}
      <div style={{ display: 'flex', gap: 4 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={COLOR_LABELS[c]}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: PEN_COLORS[c],
              border: color === c ? '2px solid #333' : '2px solid transparent',
              cursor: 'pointer',
              outline: color === c ? '2px solid #1976D2' : 'none',
            }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      {/* Thickness buttons */}
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
              border: thickness === t ? '2px solid #1976D2' : '1px solid #ccc',
              borderRadius: 4,
              background: thickness === t ? '#e3f2fd' : '#fff',
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
