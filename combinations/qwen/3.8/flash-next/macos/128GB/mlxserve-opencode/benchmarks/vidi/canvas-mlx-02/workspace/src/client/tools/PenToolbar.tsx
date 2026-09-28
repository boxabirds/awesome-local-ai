// The pen's own two choices (story 11, pen.options): which colour and how thick.
//
// It appears next to the left toolbar for as long as the Pen is the tool, and
// nowhere else - it is not a fifth tool, it is the Pen's settings. Picking one is
// React state in this tab (see usePenOptions.ts): nothing is written, so nothing
// anyone else sees changes, and the strokes already on the board keep the colour
// and weight they were drawn with. A pen style change is not an undo step, because
// nothing happened.
//
// The buttons say what they are in the order the product settings list them, and
// each one shows what it means: a swatch in its colour, a line of its weight.
import type React from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config.ts';
import type { PenColor, PenThickness } from '../../shared/config.ts';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

// The words a person reads next to each setting. The keys come from the settings
// tables, so a colour or a weight added there shows up here unasked.
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

const swatchStyle = (color: PenColor): React.CSSProperties => ({
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: PEN_COLORS[color],
  // Black on a white button needs a ring to be seen at all.
  boxShadow: '0 0 0 1px rgba(0,0,0,0.15)',
});

const buttonStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 10px',
  border: active ? '1px solid #2563eb' : '1px solid transparent',
  borderRadius: 6,
  background: active ? '#eef2ff' : 'transparent',
  color: '#202020',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
});

export function PenToolbar(props: PenToolbarProps): React.JSX.Element {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      aria-orientation="vertical"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: 92,
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: 6,
        background: '#ffffff',
        border: '1px solid #e2e2e2',
        borderRadius: 10,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        fontFamily: 'system-ui, sans-serif',
        zIndex: 10,
      }}
    >
      {/* The six colours, in the order the settings list them. */}
      {(Object.keys(PEN_COLORS) as PenColor[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={`${name} pen`}
          title={`${COLOR_LABELS[name]} pen`}
          data-testid={`pen-color-${name}`}
          aria-pressed={name === color}
          onClick={() => onColor(name)}
          style={buttonStyle(name === color)}
        >
          <span aria-hidden="true" style={swatchStyle(name)} />
          {COLOR_LABELS[name]}
        </button>
      ))}

      <span aria-hidden="true" style={{ height: 1, margin: '4px 2px', background: '#e2e2e2' }} />

      {/* The three weights. The line each one shows is drawn at the thickness it
          stands for, so the button is its own legend. */}
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
        <button
          key={name}
          type="button"
          aria-label={THICKNESS_LABELS[name]}
          title={`${THICKNESS_LABELS[name]} line`}
          data-testid={`pen-thickness-${name}`}
          aria-pressed={name === thickness}
          onClick={() => onThickness(name)}
          style={buttonStyle(name === thickness)}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'block',
              width: 16,
              height: Math.max(2, PEN_THICKNESS_WORLD[name]),
              borderRadius: 999,
              background: '#202020',
            }}
          />
          {THICKNESS_LABELS[name]}
        </button>
      ))}
    </div>
  );
}
