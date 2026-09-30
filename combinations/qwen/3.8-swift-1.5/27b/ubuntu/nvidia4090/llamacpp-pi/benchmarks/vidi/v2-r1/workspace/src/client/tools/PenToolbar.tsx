/**
 * Story 11: pen toolbar — six colour swatches and three thickness buttons,
 * visible next to the left toolbar while the Pen tool is active.
 *
 * Buttons are `button[aria-label="<colour> pen"][aria-pressed]` and
 * `button[aria-label="Thin|Medium|Thick"]` (PRD pen.options).
 */
import type { CSSProperties } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/objects/stroke';

interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor: (c: PenColor) => void;
  onThickness: (t: PenThickness) => void;
}

const COLORS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESSES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

const swatchStyle = (active: boolean): CSSProperties => ({
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: active ? '2px solid #2196F3' : '2px solid rgba(0,0,0,0.15)',
  outline: active ? '2px solid rgba(33,150,243,0.35)' : 'none',
  cursor: 'pointer',
  padding: 0,
  boxSizing: 'border-box',
});

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      data-testid="pen-toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 80,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 8,
        padding: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 1000,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {COLORS.map((c) => (
          <button
            key={c}
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            title={`${c} pen`}
            onClick={() => onColor(c)}
            style={{ ...swatchStyle(color === c), backgroundColor: PEN_COLORS[c] }}
          />
        ))}
      </div>
      <div
        style={{
          height: 1,
          width: '100%',
          background: 'rgba(0,0,0,0.1)',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        {THICKNESSES.map((t) => (
          <button
            key={t}
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            title={THICKNESS_LABELS[t]}
            onClick={() => onThickness(t)}
            style={{
              ...swatchStyle(thickness === t),
              backgroundColor: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'block',
                width: PEN_THICKNESS_WORLD[t] + 4,
                height: PEN_THICKNESS_WORLD[t] + 4,
                borderRadius: '50%',
                background: '#333',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
