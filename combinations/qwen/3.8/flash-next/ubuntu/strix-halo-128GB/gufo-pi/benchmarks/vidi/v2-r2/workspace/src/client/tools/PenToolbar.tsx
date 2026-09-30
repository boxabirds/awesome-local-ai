import type { ReactElement } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '@shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const COLOR_NAMES = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESS_NAMES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
const THICKNESS_LABELS: Record<PenThickness, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): ReactElement {
  return (
    <div
      className="pen-toolbar"
      data-board-ui="true"
      data-testid="pen-toolbar"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 6,
        background: '#fff',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', gap: 4 }}>
        {COLOR_NAMES.map((c) => (
          <button
            key={c}
            aria-label={`${c} pen`}
            aria-pressed={color === c}
            data-testid={`pen-color-${c}`}
            onClick={() => onColor(c)}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              border: color === c ? '2px solid #333' : '1px solid #ccc',
              background: PEN_COLORS[c],
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {THICKNESS_NAMES.map((t) => (
          <button
            key={t}
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            data-testid={`pen-thickness-${t}`}
            onClick={() => onThickness(t)}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              border: thickness === t ? '2px solid #333' : '1px solid #ccc',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            {THICKNESS_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  );
}
