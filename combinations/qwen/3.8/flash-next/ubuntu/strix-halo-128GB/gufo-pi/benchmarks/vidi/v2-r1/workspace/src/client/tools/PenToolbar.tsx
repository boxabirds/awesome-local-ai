/**
 * PenToolbar: six colour swatches and three thickness buttons.
 * Visible only while the Pen tool is active.
 */

import type { JSX } from 'react';

import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

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

export function PenToolbar(props: PenToolbarProps): JSX.Element {
  const { color, thickness, onColor, onThickness } = props;

  return (
    <div className="pen-toolbar" data-testid="pen-toolbar" role="toolbar" aria-label="Pen options">
      {Object.entries(PEN_COLORS).map(([name, hex]) => (
        <button
          key={name}
          type="button"
          className="pen-toolbar__color"
          data-testid={`pen-color-${name}`}
          aria-label={`${COLOR_LABELS[name as PenColor]} pen`}
          aria-pressed={color === name}
          style={{ backgroundColor: hex }}
          onClick={() => onColor(name as PenColor)}
        />
      ))}
      <span className="pen-toolbar__separator" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
        <button
          key={t}
          type="button"
          className="pen-toolbar__thickness"
          data-testid={`pen-thickness-${t}`}
          aria-label={THICKNESS_LABELS[t]}
          aria-pressed={thickness === t}
          onClick={() => onThickness(t)}
        >
          {THICKNESS_LABELS[t]}
        </button>
      ))}
    </div>
  );
}
