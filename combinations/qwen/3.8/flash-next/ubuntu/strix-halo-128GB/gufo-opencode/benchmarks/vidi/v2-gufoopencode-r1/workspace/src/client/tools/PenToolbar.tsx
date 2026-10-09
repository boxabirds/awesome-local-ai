import type { CSSProperties, JSX } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness
} from '../../shared/config';

// Story 11: the pen options panel shown next to the left toolbar while the
// Pen tool is armed (design pen.options). Choices live in session state owned
// by the viewport; this component only renders and reports clicks.

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: string): void;
  onThickness(thickness: string): void;
  disabled?: boolean;
}

const COLOR_LABEL: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple'
};

const THICKNESS_LABEL: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick'
};

const COLOR_KEYS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESS_KEYS = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];

const containerStyle: CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 82,
  // Above the Pen tool overlay (zIndex 45) so swatches are clickable while drawing.
  zIndex: 50,
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  background: '#ffffff',
  border: '1px solid #d6dae1',
  borderRadius: 10,
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.12)'
};

const swatchStyle = (color: PenColor, pressed: boolean): CSSProperties => ({
  width: 26,
  height: 26,
  background: PEN_COLORS[color],
  border: pressed ? '2px solid #212121' : '1px solid #d6dae1',
  borderRadius: '50%',
  cursor: 'pointer',
  padding: 0
});

const thicknessStyle = (pressed: boolean): CSSProperties => ({
  height: 26,
  padding: '0 8px',
  border: pressed ? '2px solid #212121' : '1px solid #d6dae1',
  background: pressed ? '#ECEFF1' : '#f3f4f6',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 12
});

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const stop = (event: { stopPropagation(): void }): void => {
    event.stopPropagation();
  };
  return (
    <div data-testid="pen-toolbar" role="group" aria-label="Pen options" style={containerStyle} onPointerDown={stop}>
      {COLOR_KEYS.map((color) => (
        <button
          key={color}
          type="button"
          data-testid={`pen-color-${color}`}
          aria-label={`${COLOR_LABEL[color]} pen`}
          title={`${COLOR_LABEL[color]} pen`}
          aria-pressed={props.color === color}
          style={swatchStyle(color, props.color === color)}
          disabled={props.disabled === true}
          onClick={() => props.onColor(color)}
        />
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 20, background: '#d6dae1' }} />
      {THICKNESS_KEYS.map((thickness) => (
        <button
          key={thickness}
          type="button"
          data-testid={`pen-thickness-${thickness}`}
          aria-label={THICKNESS_LABEL[thickness]}
          title={`${THICKNESS_LABEL[thickness]} line`}
          aria-pressed={props.thickness === thickness}
          style={thicknessStyle(props.thickness === thickness)}
          disabled={props.disabled === true}
          onClick={() => props.onThickness(thickness)}
        >
          {THICKNESS_LABEL[thickness]}
        </button>
      ))}
    </div>
  );
}
