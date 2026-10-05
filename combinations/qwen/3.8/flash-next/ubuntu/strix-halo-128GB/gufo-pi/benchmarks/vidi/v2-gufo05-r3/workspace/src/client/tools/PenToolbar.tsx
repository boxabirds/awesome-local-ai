/**
 * The Pen tool's options toolbar (`pen.options`).
 *
 * Rendered while the Pen is active: six colour swatches and three thickness
 * buttons. Choosing one restyles the crosshair cursor for the next stroke —
 * nothing on the board changes, because existing strokes carry their own ink
 * in the document.
 */
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

const COLOR_NAMES: Record<PenColor, string> = {
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

export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      className="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      // The board listens for wheel on the viewport; a scroll over the toolbar
      // must not pan the board behind it.
      onWheel={(event) => event.stopPropagation()}
      data-testid="pen-toolbar"
    >
      {(Object.keys(PEN_COLORS) as PenColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="pen-swatch"
          style={{ background: PEN_COLORS[name] }}
          aria-label={`${COLOR_NAMES[name]} pen`}
          aria-pressed={color === name}
          title={`${COLOR_NAMES[name]} pen`}
          data-pen-color={name}
          onClick={() => onColor(name)}
        />
      ))}
      <div className="pen-toolbar-sep" aria-hidden="true" />
      {(Object.keys(PEN_THICKNESS_WORLD) as PenThickness[]).map((name) => (
        <button
          key={name}
          type="button"
          className="pen-thickness"
          aria-label={THICKNESS_LABELS[name]}
          aria-pressed={thickness === name}
          title={`${THICKNESS_LABELS[name]} pen`}
          data-pen-thickness={name}
          onClick={() => onThickness(name)}
        >
          <span
            className="pen-thickness-dot"
            style={{ width: PEN_THICKNESS_WORLD[name], height: PEN_THICKNESS_WORLD[name] }}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}
