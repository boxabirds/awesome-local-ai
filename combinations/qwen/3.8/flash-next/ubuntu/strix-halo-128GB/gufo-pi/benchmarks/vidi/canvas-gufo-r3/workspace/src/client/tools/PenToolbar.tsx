import React from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '@shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

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

/**
 * Pen toolbar shown while the Pen tool is active: six colour swatches and three thickness buttons.
 * Positioned next to the left toolbar.
 */
export function PenToolbar(props: PenToolbarProps): React.ReactElement {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      data-testid="pen-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: '72px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '8px',
        padding: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 101,
      }}
    >
      {/* Colour swatches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={COLOR_LABELS[c]}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            onClick={() => onColor(c)}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              border: color === c ? '2px solid #1976D2' : '1px solid #CCC',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              outline: color === c ? '2px solid #1976D2' : 'none',
              outlineOffset: '2px',
            }}
          />
        ))}
      </div>
      {/* Thickness buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            onClick={() => onThickness(t)}
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              outline: thickness === t ? '2px solid #1976D2' : 'none',
              outlineOffset: '1px',
            }}
          >
            <div
              style={{
                width: `${PEN_THICKNESS_WORLD[t]}px`,
                height: `${PEN_THICKNESS_WORLD[t]}px`,
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
