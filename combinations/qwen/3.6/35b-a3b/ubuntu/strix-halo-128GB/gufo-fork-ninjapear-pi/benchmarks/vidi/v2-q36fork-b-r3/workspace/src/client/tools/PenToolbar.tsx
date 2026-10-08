import React from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/config';

interface PenToolbarProps {
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

const THICKNESS_ORDER: PenThickness[] = ['thin', 'medium', 'thick'];

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: 60,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
        background: '#fff',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      role="toolbar"
      aria-label="Pen options"
    >
      {/* Colour swatches */}
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          aria-label={`${c} pen`}
          aria-pressed={color === c}
          title={`${c} pen`}
          onClick={() => onColor(c)}
          style={{
            width: 32,
            height: 32,
            border: color === c ? '2px solid #2196F3' : '2px solid #ccc',
            borderRadius: '50%',
            background: PEN_COLORS[c],
            cursor: 'pointer',
            outline: 'none',
          }}
        />
      ))}
      <div style={{ borderTop: '1px solid #ddd', margin: '4px 0' }} />
      {/* Thickness buttons */}
      {THICKNESS_ORDER.map((t) => (
        <button
          key={t}
          aria-label={THICKNESS_LABELS[t]}
          aria-pressed={thickness === t}
          title={THICKNESS_LABELS[t]}
          onClick={() => onThickness(t)}
          style={{
            width: 32,
            height: 32,
            border: thickness === t ? '2px solid #2196F3' : '1px solid #ccc',
            borderRadius: 4,
            background: thickness === t ? '#e3f2fd' : '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 8,
            fontWeight: thickness === t ? 700 : 400,
            color: thickness === t ? '#1565c0' : '#333',
            outline: 'none',
          }}
        >
          <div
            style={{
              width: 16,
              height: 2 + PEN_THICKNESS_WORLD[t] * 0.5,
              background: thickness === t ? '#1565c0' : '#666',
              borderRadius: 1,
            }}
          />
        </button>
      ))}
    </div>
  );
}
