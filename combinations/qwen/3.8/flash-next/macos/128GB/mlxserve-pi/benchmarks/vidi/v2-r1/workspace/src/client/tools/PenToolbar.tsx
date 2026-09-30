// The pen's own options: six colours, three thicknesses (`pen.options`).
//
// These are the only two decisions a person makes with the Pen tool, so they are on screen
// while it is up and nowhere else: not in a menu, not in a dialog, not remembered between
// sessions. Each is a button that says what it is and looks like what it does — a swatch in
// the colour, a mark as thick as the thickness — because the thing you are checking when you
// reach for one of these is what your next line will look like.
//
// The values live in the board (`usePenOptions`) and not here: this component is shown what
// is chosen and says what was clicked. It is a plain presentational component with no state
// of its own, which is what makes TC-14 testable as a render: an existing stroke is drawn
// from its own stored colour, so choosing another can only ever change the next stroke.
//
// Spec: spec/stories/011-sketch-freehand-with-a-pen/design.md (pen.tool)
import { type CSSProperties, type ReactNode } from 'react';
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

/** `button[aria-label="Black pen"]`, `button[aria-label="Blue pen"]`: the palette's names. */
export const PEN_COLOR_LABEL: Record<PenColor, string> = {
  black: 'Black pen',
  blue: 'Blue pen',
  red: 'Red pen',
  green: 'Green pen',
  orange: 'Orange pen',
  purple: 'Purple pen',
};

/** `button[aria-label="Thin"]` and the two that go with it. */
export const PEN_THICKNESS_LABEL: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

const panelStyle: CSSProperties = {
  position: 'fixed',
  // Clear of the tool rail, and alongside it rather than in it: six colours and three
  // thicknesses would push everything else off the bottom of the screen.
  left: 68,
  top: '50%',
  transform: 'translateY(-50%)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 6,
  borderRadius: 10,
  backgroundColor: 'rgba(255, 255, 255, 0.94)',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.20)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
};

const swatchStyle = (color: PenColor, active: boolean): CSSProperties => ({
  width: 22,
  height: 22,
  padding: 0,
  borderRadius: '50%',
  border: active ? '2px solid #1f2328' : '1px solid rgba(0, 0, 0, 0.2)',
  backgroundColor: PEN_COLORS[color],
  boxShadow: active ? '0 0 0 2px #ffffff inset' : 'none',
  cursor: 'pointer',
});

const thicknessStyle = (active: boolean): CSSProperties => ({
  width: 30,
  height: 22,
  padding: 0,
  borderRadius: 6,
  border: active ? '1px solid #1f2328' : '1px solid #d6dae0',
  backgroundColor: active ? '#eef2f7' : '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
});

const markStyle = (thickness: PenThickness): CSSProperties => ({
  width: 18,
  height: Math.max(2, PEN_THICKNESS_WORLD[thickness]),
  borderRadius: 999,
  backgroundColor: '#5f6368',
});

/**
 * The pen's colour and thickness, shown while the Pen tool is up. Stops pointer events so
 * choosing a colour is never a press on the board underneath, which would clear the
 * selection or start a stroke.
 */
export function PenToolbar({
  color,
  thickness,
  onColor,
  onThickness,
}: PenToolbarProps): ReactNode {
  return (
    <div
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      aria-orientation="vertical"
      style={panelStyle}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div style={rowStyle}>
        {(Object.keys(PEN_COLORS) as PenColor[]).map((name: PenColor) => (
          <button
            key={name}
            type="button"
            data-testid={`pen-color-${name}`}
            aria-label={PEN_COLOR_LABEL[name] ?? name}
            title={`${PEN_COLOR_LABEL[name] ?? name} \u2013 what the next stroke is drawn in`}
            aria-pressed={name === color}
            style={swatchStyle(name, name === color)}
            onClick={() => {
              onColor(name);
            }}
          />
        ))}
      </div>
      <div style={rowStyle}>
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name: PenThickness) => (
          <button
            key={name}
            type="button"
            data-testid={`pen-thickness-${name}`}
            aria-label={PEN_THICKNESS_LABEL[name] ?? name}
            title={`${PEN_THICKNESS_LABEL[name] ?? name} \u2013 how thick the next stroke is`}
            aria-pressed={name === thickness}
            style={thicknessStyle(name === thickness)}
            onClick={() => {
              onThickness(name);
            }}
          >
            {/* The mark is drawn at the thickness it stands for, which is the only way this
                row says anything a label could not. */}
            <span style={markStyle(name)} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
