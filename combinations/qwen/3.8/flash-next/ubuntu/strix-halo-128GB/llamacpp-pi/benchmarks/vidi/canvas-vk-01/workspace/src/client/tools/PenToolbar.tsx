import { type JSX } from 'react';
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

/**
 * Pen options toolbar: six colour swatches and three thickness buttons.
 * Visible only while the Pen tool is active.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps): JSX.Element {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="pen-toolbar-colors" role="group" aria-label="Pen colour">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            data-testid={`pen-color-${c}`}
            aria-label={COLOR_LABELS[c]}
            aria-pressed={color === c}
            className={`pen-swatch pen-swatch-${c}`}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      <div className="pen-toolbar-thickness" role="group" aria-label="Pen thickness">
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`pen-thickness-${t}`}
            aria-label={THICKNESS_LABELS[t]}
            aria-pressed={thickness === t}
            className={`pen-thickness-btn${thickness === t ? ' pen-thickness-btn-active' : ''}`}
            onClick={() => onThickness(t)}
          >
            <span aria-hidden="true">{THICKNESS_LABELS[t]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
