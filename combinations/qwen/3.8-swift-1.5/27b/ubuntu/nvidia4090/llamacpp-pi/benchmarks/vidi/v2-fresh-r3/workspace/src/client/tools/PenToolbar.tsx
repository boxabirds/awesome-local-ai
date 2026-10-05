import type { JSX } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenToolbarProps {
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

const THICKNESS_ORDER: readonly PenThickness[] = ['thin', 'medium', 'thick'];

/**
 * The pen toolbar (pen.options): six colour swatches and three thickness
 * buttons, visible only while the Pen tool is active. Swatches are
 * `button[aria-label="<colour> pen"][aria-pressed]`; thickness buttons are
 * `button[aria-label="Thin|Medium|Thick"][aria-pressed]`.
 */
export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;
  return (
    <div
      data-testid="pen-toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        background: 'rgba(255, 255, 255, 0.95)',
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: '4px 6px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
    >
      {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
        <button
          key={c}
          type="button"
          data-testid={`pen-color-${c}`}
          aria-label={`${c} pen`}
          aria-pressed={color === c}
          title={`${c} pen`}
          onClick={() => onColor(c)}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            border: color === c ? '2px solid #1A73E8' : '1px solid #999',
            background: PEN_COLORS[c],
            cursor: 'pointer',
            padding: 0,
            boxSizing: 'border-box',
          }}
        />
      ))}
      <span style={{ width: 1, height: 20, background: '#ddd', margin: '0 4px' }} />
      {THICKNESS_ORDER.map((t) => (
        <button
          key={t}
          type="button"
          data-testid={`pen-thickness-${t}`}
          aria-label={THICKNESS_LABELS[t]}
          aria-pressed={thickness === t}
          title={THICKNESS_LABELS[t]}
          onClick={() => onThickness(t)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 22,
            border: thickness === t ? '2px solid #1A73E8' : '1px solid transparent',
            borderRadius: 4,
            background: 'transparent',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <span
            style={{
              display: 'block',
              width: PEN_THICKNESS_WORLD[t],
              height: PEN_THICKNESS_WORLD[t],
              borderRadius: '50%',
              background: '#212121',
            }}
          />
        </button>
      ))}
    </div>
  );
}
