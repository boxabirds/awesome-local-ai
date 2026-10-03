/**
 * Pen toolbar (story 11, pen.tool).
 *
 * Visible while the Pen tool is active. Shows six colour swatches and
 * three thickness buttons. Each button has an accessible name and
 * aria-pressed state.
 */

import type { JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

const COLOR_NAMES: Record<PenColor, string> = {
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

interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label="Pen options"
      data-testid="pen-toolbar"
      style={{
        position: 'absolute',
        top: 60,
        left: 52,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        background: '#fff',
        border: '1px solid #d0d0d0',
        borderRadius: 8,
        boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        zIndex: 10,
      }}
    >
      {/* Colour swatches */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`pen-color-${c}`}
            aria-label={`${COLOR_NAMES[c]} pen`}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              border: color === c ? '2px solid #1a73e8' : '2px solid transparent',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      {/* Thickness buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`pen-thickness-${t}`}
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            onClick={() => onThickness(t)}
            style={{
              width: 32,
              height: 24,
              borderRadius: 4,
              border: thickness === t ? '2px solid #1a73e8' : '1px solid #d0d0d0',
              background: thickness === t ? '#e8f0fe' : 'transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
            }}
          >
            <div
              style={{
                width: 20,
                height: PEN_THICKNESS_WORLD[t],
                borderRadius: PEN_THICKNESS_WORLD[t] / 2,
                background: '#333',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
