// Pen toolbar (see spec: pen.options): the six colour swatches and the
// three thickness buttons, shown next to the left toolbar while the Pen
// tool is active. Each control announces its name and pressed state
// (accessibility contract: "black pen", "Thin", …).

import { PEN_COLORS, PEN_THICKNESS_WORLD } from '../../shared/config';
import type { PenColor, PenThickness } from '../../shared/objects/stroke';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

const COLOR_NAMES: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

const THICKNESS_NAMES: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

/** The pen options toolbar (see spec: pen.options). */
export function PenToolbar(props: PenToolbarProps): React.ReactElement {
  const colors = Object.keys(PEN_COLORS) as PenColor[];
  const thicknesses = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
  return (
    <div
      data-testid="pen-toolbar"
      className="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="pen-toolbar__group" role="group" aria-label="Pen colour">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            className="pen-toolbar__swatch"
            data-testid={`pen-color-${c}`}
            aria-label={`${COLOR_NAMES[c]} pen`}
            title={`${COLOR_NAMES[c]} pen`}
            aria-pressed={props.color === c}
            style={{ background: PEN_COLORS[c] }}
            onClick={() => props.onColor(c)}
          />
        ))}
      </div>
      <div className="pen-toolbar__group" role="group" aria-label="Pen thickness">
        {thicknesses.map((t) => (
          <button
            key={t}
            type="button"
            className="pen-toolbar__thickness"
            data-testid={`pen-thickness-${t}`}
            aria-label={THICKNESS_NAMES[t]}
            title={THICKNESS_NAMES[t]}
            aria-pressed={props.thickness === t}
            onClick={() => props.onThickness(t)}
          >
            <span
              className="pen-toolbar__thickness-dot"
              style={{
                width: PEN_THICKNESS_WORLD[t] * 2,
                height: PEN_THICKNESS_WORLD[t] * 2,
              }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
