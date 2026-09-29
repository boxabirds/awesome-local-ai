// The pen toolbar (story 11, pen.options): six colour swatches and three
// thickness buttons, shown next to the left toolbar while the Pen tool is
// active. Changing a choice only affects SUBSEQUENT strokes (pen.options);
// existing strokes are untouched.

import type { ReactElement } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export const PEN_COLOR_LABELS: Record<PenColor, string> = {
  black: 'black',
  blue: 'blue',
  red: 'red',
  green: 'green',
  orange: 'orange',
  purple: 'purple',
};

export const PEN_THICKNESS_LABELS: Record<PenThickness, string> = {
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

export function PenToolbar(props: PenToolbarProps): ReactElement {
  return (
    <div className="pen-toolbar" data-testid="pen-toolbar" aria-label="Pen options">
      <div className="pen-toolbar-group" role="group" aria-label="Pen colour">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="pen-swatch"
            aria-label={`${PEN_COLOR_LABELS[c]} pen`}
            title={`${PEN_COLOR_LABELS[c]} pen`}
            aria-pressed={props.color === c}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className="pen-toolbar-group" role="group" aria-label="Pen thickness">
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((t) => (
          <button
            key={t}
            type="button"
            className="pen-thickness"
            aria-label={PEN_THICKNESS_LABELS[t]}
            title={PEN_THICKNESS_LABELS[t]}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
          >
            <span
              aria-hidden="true"
              style={{
                width: 14,
                height: PEN_THICKNESS_WORLD[t] + 2,
                borderRadius: (PEN_THICKNESS_WORLD[t] + 2) / 2,
                background: 'currentColor',
                display: 'block',
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
