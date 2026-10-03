// Pen toolbar (story 11): six colour swatches and three thickness buttons.
// Visible only while the Pen tool is active; choices are session-only.

import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

const COLORS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESSES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): React.ReactElement {
  return (
    <div
      data-testid="pen-toolbar"
      style={{
        position: 'fixed',
        left: '64px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        zIndex: 100,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${c} pen`}
          aria-pressed={color === c}
          data-testid={`pen-color-${c}`}
          title={c}
          onClick={() => onColor(c)}
          style={{
            width: '26px',
            height: '26px',
            borderRadius: '50%',
            padding: 0,
            cursor: 'pointer',
            backgroundColor: PEN_COLORS[c],
            border:
              color === c
                ? '3px solid #1976D2'
                : '2px solid rgba(0,0,0,0.15)',
            boxSizing: 'border-box',
          }}
        />
      ))}
      <div style={{ height: '1px', width: '22px', backgroundColor: '#E0E0E0', margin: '4px 0' }} />
      {THICKNESSES.map((t) => (
        <button
          key={t}
          type="button"
          aria-label={THICKNESS_LABELS[t]}
          aria-pressed={thickness === t}
          data-testid={`pen-thickness-${t}`}
          title={THICKNESS_LABELS[t]}
          onClick={() => onThickness(t)}
          style={{
            width: '34px',
            height: '30px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: thickness === t ? '#E3F2FD' : 'transparent',
            boxShadow: thickness === t ? 'inset 0 0 0 2px #1976D2' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: '22px',
              height: `${PEN_THICKNESS_WORLD[t]}px`,
              borderRadius: '3px',
              backgroundColor: '#333',
            }}
          />
        </button>
      ))}
    </div>
  );
}
