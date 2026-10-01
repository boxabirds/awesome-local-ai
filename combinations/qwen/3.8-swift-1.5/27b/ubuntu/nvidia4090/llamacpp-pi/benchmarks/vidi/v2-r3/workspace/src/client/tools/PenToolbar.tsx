import type { ReactElement } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

const COLOR_LABELS: Record<PenColor, string> = {
  black: 'Black pen',
  blue: 'Blue pen',
  red: 'Red pen',
  green: 'Green pen',
  orange: 'Orange pen',
  purple: 'Purple pen',
};

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor: (c: PenColor) => void;
  onThickness: (t: PenThickness) => void;
}

/**
 * The Pen toolbar (story 11, pen.options): six colours and three thicknesses,
 * shown while the pen is active (the design puts it on the left of the board).
 * The current colour / thickness is indicated with `aria-pressed`.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): ReactElement {
  return (
    <div
      data-testid="pen-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 64,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: 'rgba(255,255,255,0.94)',
        border: '1px solid #d0d0d0',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        zIndex: 20,
      }}
    >
      {/* Colours */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={COLOR_LABELS[c]}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: PEN_COLORS[c],
              border: '1px solid rgba(0,0,0,0.25)',
              outline: color === c ? '2px solid #4285f4' : 'none',
              outlineOffset: 1,
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      {/* Thicknesses */}
      <div
        style={{
          height: 1,
          background: '#d0d0d0',
          margin: '0 2px',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'center' }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            onClick={() => onThickness(t)}
            style={{
              width: 26,
              height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              outline: thickness === t ? '2px solid #4285f4' : 'none',
              borderRadius: 4,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'block',
                width: 18,
                height: Math.max(2, PEN_THICKNESS_WORLD[t] - 2),
                background: '#333',
                borderRadius: 2,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
