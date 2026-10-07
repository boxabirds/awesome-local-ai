import {
  PEN_COLORS,
  PEN_COLOR_NAMES,
  PEN_THICKNESS_LABELS,
  PEN_THICKNESS_NAMES,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from "../../shared/config";

/**
 * `tools.PenToolbar` — the pen's six colours and three thicknesses (story 11).
 *
 * It appears beside the left toolbar while the Pen tool is armed, because which
 * colour and thickness the *next* stroke is drawn with comes from this choice and
 * not from the drag. Six swatches (`aria-label="Red pen"`, `aria-pressed`) and three
 * buttons (`Thin`/`Medium`/`Thick`); the swatch shows the colour it selects, and a
 * thickness button is drawn with the line width it stands for, so the choice is
 * readable without knowing the numbers.
 *
 * Like the board toolbar, it stops pointer events: choosing a colour is not a press
 * on the board, and must not start a stroke or pan the view.
 */
export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor?(color: PenColor): void;
  onThickness?(thickness: PenThickness): void;
}

/** "Red pen", "Blue pen" — the accessible name of each swatch. */
function swatchLabel(color: PenColor): string {
  return `${color[0]!.toUpperCase()}${color.slice(1)} pen`;
}

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      aria-orientation="vertical"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="pen-swatches" data-testid="pen-colors" role="group" aria-label="Pen colour">
        {PEN_COLOR_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="pen-swatch"
            data-testid={`pen-color-${name}`}
            data-pen-color={name}
            aria-label={swatchLabel(name)}
            title={swatchLabel(name)}
            aria-pressed={color === name}
            style={{ background: PEN_COLORS[name] }}
            onClick={() => onColor?.(name)}
          />
        ))}
      </div>
      <div className="pen-thicknesses" data-testid="pen-thicknesses" role="group" aria-label="Pen thickness">
        {PEN_THICKNESS_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="pen-thickness"
            data-testid={`pen-thickness-${name}`}
            data-pen-thickness={name}
            aria-label={PEN_THICKNESS_LABELS[name]}
            title={`${PEN_THICKNESS_LABELS[name]} (${PEN_THICKNESS_WORLD[name]} board units)`}
            aria-pressed={thickness === name}
            onClick={() => onThickness?.(name)}
          >
            <span className="pen-thickness-glyph" aria-hidden="true" style={{ height: `${PEN_THICKNESS_WORLD[name]}px` }} />
            <span className="tool-label">{PEN_THICKNESS_LABELS[name]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
