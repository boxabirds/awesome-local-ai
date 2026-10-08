import * as React from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const THICKNESS_OPTIONS: Array<{ key: PenThickness; label: string }> = [
  { key: 'thin', label: 'Thin' },
  { key: 'medium', label: 'Medium' },
  { key: 'thick', label: 'Thick' },
];

export function PenToolbar(props: PenToolbarProps): React.JSX.Element {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      style={{
        position: 'fixed',
        left: '56px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        zIndex: 98,
        background: '#fff',
        border: '1px solid #ccc',
        borderRadius: '8px',
        padding: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Colour swatches */}
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          aria-label={`${c} pen`}
          aria-pressed={color === c}
          onClick={() => onColor(c)}
          title={`${c} – click to select`}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            border: color === c ? '3px solid #1a73e8' : `2px solid ${PEN_COLORS[c]}`,
            background: PEN_COLORS[c],
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxSizing: 'border-box',
          }}
        >
          {color === c && (
            <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px' }}>✓</span>
          )}
        </button>
      ))}

      {/* Thickness buttons */}
      <div style={{ borderTop: '1px solid #ddd', paddingTop: '4px', marginTop: '2px' }}>
        {THICKNESS_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            aria-label={opt.label}
            aria-pressed={thickness === opt.key}
            onClick={() => onThickness(opt.key)}
            title={`${opt.label} – click to select`}
            style={{
              width: '32px',
              height: '32px',
              border: thickness === opt.key ? '2px solid #1a73e8' : '1px solid #ccc',
              borderRadius: '6px',
              background: thickness === opt.key ? '#e8f0fe' : '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              margin: '2px 0',
              fontSize: `${Math.max(8, PEN_THICKNESS_WORLD[opt.key] * 2)}px`,
              lineHeight: 1,
              fontFamily: 'sans-serif',
            }}
          >
            <span style={{ display: 'inline-block', backgroundColor: '#333', borderRadius: '50%' }} />
          </button>
        ))}
      </div>
    </div>
  );
}
