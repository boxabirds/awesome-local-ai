/**
 * Pen toolbar (story 11, pen.options): six colour swatches and three
 * thickness buttons, visible while the Pen tool is active.
 *
 *   button[aria-label="<colour> pen"][aria-pressed]  × 6
 *   button[aria-label="Thin|Medium|Thick"]           × 3
 */
import type { ReactElement } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

const COLORS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESSES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

const LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}): ReactElement {
  return (
    <div
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      style={{
        position: 'absolute',
        top: 12,
        left: 320,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 10px',
        background: '#ffffff',
        border: '1px solid #d1d5db',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`pen-color-${c}`}
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            title={`${c} pen`}
            onClick={() => onColor(c)}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: color === c ? '3px solid #3b82f6' : '1px solid rgba(0,0,0,0.25)',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              padding: 0,
              boxSizing: 'border-box',
            }}
          />
        ))}
      </div>
      <div style={{ width: 1, height: 22, background: '#e5e7eb' }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {THICKNESSES.map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`pen-thickness-${t}`}
            aria-label={LABELS[t]}
            aria-pressed={thickness === t}
            title={LABELS[t]}
            onClick={() => onThickness(t)}
            style={{
              width: 34,
              height: 30,
              borderRadius: 6,
              border: thickness === t ? '2px solid #3b82f6' : '1px solid #d1d5db',
              background: thickness === t ? '#dbeafe' : '#ffffff',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <span
              style={{
                display: 'block',
                width: 18,
                height: Math.max(1, PEN_THICKNESS_WORLD[t]),
                borderRadius: 2,
                background: '#374151',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
