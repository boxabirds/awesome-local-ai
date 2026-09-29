/**
 * Pen toolbar (story 11).
 * Six colour swatches and three thickness buttons, visible while Pen tool is active.
 */
import type { JSX } from 'react';
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
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const colors = Object.keys(PEN_COLORS) as PenColor[];
  const thicknesses: PenThickness[] = ['thin', 'medium', 'thick'];

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      style={{
        position: 'absolute',
        left: '56px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '8px',
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10001,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={COLOR_LABELS[c]}
          aria-pressed={props.color === c}
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: props.color === c ? '2px solid #333' : '1px solid #ccc',
            backgroundColor: PEN_COLORS[c],
            cursor: 'pointer',
            outline: props.color === c ? '2px solid #4A90D9' : 'none',
            outlineOffset: '1px',
          }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <div style={{ borderTop: '1px solid #eee', margin: '4px 0' }} />
      {thicknesses.map((t) => (
        <button
          key={t}
          type="button"
          aria-label={THICKNESS_LABELS[t]}
          aria-pressed={props.thickness === t}
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '4px',
            border: props.thickness === t ? '2px solid #4A90D9' : '1px solid #ccc',
            background: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => props.onThickness(t)}
        >
          <div
            style={{
              width: `${PEN_THICKNESS_WORLD[t] + 2}px`,
              height: `${PEN_THICKNESS_WORLD[t] + 2}px`,
              borderRadius: '50%',
              background: '#333',
            }}
          />
        </button>
      ))}
    </div>
  );
}
