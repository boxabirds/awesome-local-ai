// src/client/tools/PenToolbar.tsx
// Pen toolbar: six colour swatches and three thickness buttons.

import type { ReactElement } from 'react';
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

export function PenToolbar(props: PenToolbarProps): ReactElement {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      data-testid="pen-toolbar"
      style={{
        position: 'fixed',
        left: 60,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        zIndex: 1000,
        background: 'white',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Colour swatches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            data-testid={`pen-color-${c}`}
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: color === c ? '3px solid #2196F3' : '2px solid #ccc',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>

      {/* Thickness buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: '1px solid #eee', paddingTop: 6 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            data-testid={`pen-thickness-${t}`}
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            onClick={() => onThickness(t)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              border: thickness === t ? '2px solid #2196F3' : '1px solid #ccc',
              background: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <div
              style={{
                width: '100%',
                height: PEN_THICKNESS_WORLD[t],
                background: '#212121',
                borderRadius: 2,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
