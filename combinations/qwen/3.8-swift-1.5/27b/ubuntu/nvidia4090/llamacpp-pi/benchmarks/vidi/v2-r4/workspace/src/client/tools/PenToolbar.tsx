import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const thicknessLabels: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

const swatchStyle = (selected: boolean): React.CSSProperties => ({
  width: 24,
  height: 24,
  borderRadius: '50%',
  border: selected ? '2px solid #2196F3' : '1px solid #999',
  cursor: 'pointer',
  padding: 0,
});

/**
 * Pen toolbar (visible while the Pen tool is active): six colour swatches and
 * three thickness buttons, next to the left toolbar.
 */
export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      data-testid="pen-toolbar"
      style={{
        position: 'fixed',
        left: 64,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        backgroundColor: '#fff',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            aria-label={`${c} pen`}
            title={`${c[0].toUpperCase()}${c.slice(1)} pen`}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
            style={{ ...swatchStyle(color === c), backgroundColor: PEN_COLORS[c] }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            aria-label={thicknessLabels[t]}
            title={`${thicknessLabels[t]} pen`}
            aria-pressed={thickness === t}
            onClick={() => onThickness(t)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              border: thickness === t ? '2px solid #2196F3' : '1px solid #ccc',
              backgroundColor: thickness === t ? '#BBDEFB' : '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <span
              style={{
                display: 'block',
                width: PEN_THICKNESS_WORLD[t],
                height: PEN_THICKNESS_WORLD[t],
                borderRadius: '50%',
                backgroundColor: '#212121',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
