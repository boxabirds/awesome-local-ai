/**
 * Pen toolbar (story 11). Six colour swatches and three thickness buttons,
 * visible while the Pen tool is active. Changing options never touches
 * strokes already drawn (pen.options).
 */
import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor: (c: PenColor) => void;
  onThickness: (t: PenThickness) => void;
}

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/**
 * Toolbar with pen colour swatches and thickness buttons.
 */
export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '8px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {/* Colour swatches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            onClick={() => onColor(c)}
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '50%',
              border: color === c ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.3)',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              padding: 0,
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>

      {/* Thickness buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            onClick={() => onThickness(t)}
            style={{
              width: '22px',
              height: '22px',
              borderRadius: '4px',
              border: thickness === t ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.2)',
              background: thickness === t ? '#E8F0FE' : 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              boxSizing: 'border-box',
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${Math.max(PEN_THICKNESS_WORLD[t] / 2, 1)}px`,
                height: `${Math.max(PEN_THICKNESS_WORLD[t] / 2, 1)}px`,
                borderRadius: '50%',
                background: '#212121',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
