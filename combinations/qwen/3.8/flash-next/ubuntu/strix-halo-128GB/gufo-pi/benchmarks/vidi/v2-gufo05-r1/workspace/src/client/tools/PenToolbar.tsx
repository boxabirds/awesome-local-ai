/**
 * The Pen tool's options: six ink colours and three thicknesses (`pen.tool_ui`).
 *
 * It is shown only while the Pen tool is armed, next to the main toolbar and on a higher layer
 * than the drawing surface, so choosing a colour never leaves a mark on the board. The current
 * colour and thickness are pressed; every choice is named in its accessible name and tooltip so
 * the swatches are not told apart by colour alone.
 */
import {
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/** Capitalised colour names, for accessible names and tooltips. */
const COLOR_LABELS: Record<PenColor, string> = {
  black: 'Black',
  blue: 'Blue',
  red: 'Red',
  green: 'Green',
  orange: 'Orange',
  purple: 'Purple',
};

/** The three thicknesses in button order, with the words a person reads on each. */
const THICKNESS_LABELS: Record<PenThickness, string> = {
  thin: 'Thin',
  medium: 'Medium',
  thick: 'Thick',
};

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
}

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  // A choice here belongs to the toolbar, never to the board beneath it: it must not draw.
  const stop = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stop}
    >
      <div className="pen-toolbar__colors" data-testid="pen-color-swatches">
        {(Object.keys(PEN_COLORS) as PenColor[]).map((name) => (
          <button
            key={name}
            type="button"
            className={`pen-toolbar__swatch${name === color ? ' pen-toolbar__swatch--active' : ''}`}
            style={{ backgroundColor: PEN_COLORS[name] }}
            aria-label={`${COLOR_LABELS[name]} pen`}
            aria-pressed={name === color}
            title={`${COLOR_LABELS[name]} pen`}
            onPointerDown={stop}
            onClick={() => onColor(name)}
          />
        ))}
      </div>
      <div className="pen-toolbar__thicknesses" data-testid="pen-thickness-buttons">
        {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
          <button
            key={name}
            type="button"
            className={`pen-toolbar__thickness${name === thickness ? ' pen-toolbar__thickness--active' : ''}`}
            aria-label={THICKNESS_LABELS[name]}
            aria-pressed={name === thickness}
            title={`${THICKNESS_LABELS[name]} pen`}
            onPointerDown={stop}
            onClick={() => onThickness(name)}
          >
            <span
              className="pen-toolbar__thickness-dot"
              style={{ width: PEN_THICKNESS_WORLD[name] + 2, height: PEN_THICKNESS_WORLD[name] + 2 }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
