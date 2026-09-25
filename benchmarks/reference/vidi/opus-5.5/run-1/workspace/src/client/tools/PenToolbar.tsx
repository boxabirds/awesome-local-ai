import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

export const PEN_TOOLBAR_LABEL = 'Pen';

function capitalise(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** "Red pen" (accessible name and tooltip of a colour swatch). */
export function penColorLabel(c: PenColor): string {
  return `${capitalise(c)} pen`;
}

/** "Thin", "Medium", "Thick". */
export function thicknessLabel(t: PenThickness): string {
  return capitalise(t);
}

const COLORS = Object.keys(PEN_COLORS) as PenColor[];
const THICKNESSES = Object.keys(PEN_THICKNESS_WORLD) as PenThickness[];
/** Width and height of the thickness sample icon, px. */
const SAMPLE_SIZE_PX = 22;
const SAMPLE_INSET_PX = 4;
const HALF = 2;

export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

/**
 * The pen toolbar (pen.options), shown next to the left toolbar while the Pen is active: six
 * colour swatches and Thin / Medium / Thick, the current choices pressed.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  return (
    <div
      className="pen-toolbar"
      role="toolbar"
      aria-label={PEN_TOOLBAR_LABEL}
      aria-orientation="vertical"
      data-testid="pen-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="pen-toolbar__group" role="group" aria-label="Colour">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="note-toolbar__swatch pen-toolbar__swatch"
            aria-label={penColorLabel(c)}
            title={penColorLabel(c)}
            aria-pressed={c === color}
            data-color={c}
            style={{ backgroundColor: PEN_COLORS[c] }}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      <div className="note-toolbar__divider pen-toolbar__divider" />
      <div className="pen-toolbar__group" role="group" aria-label="Thickness">
        {THICKNESSES.map((t) => (
          <button
            key={t}
            type="button"
            className="toolbar__button pen-toolbar__thickness"
            aria-label={thicknessLabel(t)}
            title={thicknessLabel(t)}
            aria-pressed={t === thickness}
            data-thickness={t}
            onClick={() => onThickness(t)}
          >
            <svg width={SAMPLE_SIZE_PX} height={SAMPLE_SIZE_PX} aria-hidden="true" focusable="false">
              <line
                x1={SAMPLE_INSET_PX}
                y1={SAMPLE_SIZE_PX / HALF}
                x2={SAMPLE_SIZE_PX - SAMPLE_INSET_PX}
                y2={SAMPLE_SIZE_PX / HALF}
                stroke="currentColor"
                strokeWidth={PEN_THICKNESS_WORLD[t]}
                strokeLinecap="round"
              />
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
