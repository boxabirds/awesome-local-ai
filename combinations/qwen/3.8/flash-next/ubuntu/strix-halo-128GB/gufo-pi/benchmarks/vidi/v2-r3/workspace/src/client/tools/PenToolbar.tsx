/**
 * PenToolbar (story 11): colour swatches and thickness buttons for the Pen tool.
 */
import React from 'react';
import type { PenColor, PenThickness } from '../../shared/config';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const COLOR_LABELS: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      data-testid="pen-toolbar"
      style={{
        position: 'fixed',
        left: 70,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
        zIndex: 10,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Colour swatches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`${COLOR_LABELS[c]} pen`}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            onClick={() => onColor(c)}
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              border: color === c ? '3px solid #1976D2' : '2px solid #ccc',
              backgroundColor: PEN_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      {/* Divider */}
      <div style={{ height: 1, backgroundColor: '#e0e0e0' }} />
      {/* Thickness buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            onClick={() => onThickness(t)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 28,
              border: thickness === t ? '2px solid #1976D2' : '1px solid #ccc',
              borderRadius: 6,
              backgroundColor: thickness === t ? '#E3F2FD' : '#fff',
              cursor: 'pointer',
              padding: '2px 4px',
            }}
          >
            <div
              style={{
                width: 16,
                height: PEN_THICKNESS_WORLD[t],
                borderRadius: PEN_THICKNESS_WORLD[t] / 2,
                backgroundColor: '#333',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
