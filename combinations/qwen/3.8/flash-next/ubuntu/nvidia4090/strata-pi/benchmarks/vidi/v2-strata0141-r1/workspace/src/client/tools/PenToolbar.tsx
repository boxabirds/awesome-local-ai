import {
  PEN_COLOR_NAMES,
  PEN_THICKNESS_LABELS,
  PEN_THICKNESS_NAMES,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  penColorLabel,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

/**
 * The Pen tool's options (`pen.options`).
 *
 * Six colours and three thicknesses, shown while the Pen tool is in hand and gone
 * when it is not - the same shape the Shape tool's kind row has, because a pen
 * option is chosen *before* the stroke is drawn and then lives inside that stroke.
 * Each control is an ordinary button: reachable by Tab, announced with the name
 * `usePenOptions` holds it under, and marked `aria-pressed` so the choice that is
 * in effect can be read as well as seen.
 *
 * Nothing here touches a stroke that already exists. These two values are the
 * settings for the next stroke only (`TC-14`), and they are never written to the
 * document, so they are also never shared: two people on one board each hold their
 * own pen.
 */
export interface PenToolbarProps {
  color: PenColor;
  thickness: PenThickness;
  onColor(color: PenColor): void;
  onThickness(thickness: PenThickness): void;
  /** False on a board this client may not edit: the options are pointless then. */
  disabled?: boolean;
}

export function PenToolbar(props: PenToolbarProps) {
  const { color, thickness, onColor, onThickness, disabled = false } = props;

  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      data-board-chrome="true"
      data-pen-color={color}
      data-pen-thickness={thickness}
      role="group"
      aria-label="Pen options"
    >
      <div className="pen-toolbar__colors" role="group" aria-label="Pen colour">
        {PEN_COLOR_NAMES.map((name: PenColor) => {
          const label = penColorLabel(name);
          return (
            <button
              key={name}
              type="button"
              className={`pen-toolbar__swatch${color === name ? ' pen-toolbar__swatch--active' : ''}`}
              data-testid={`pen-color-${name}`}
              data-color={name}
              aria-label={label}
              title={label}
              aria-pressed={color === name}
              disabled={disabled}
              style={{ backgroundColor: PEN_COLORS[name] }}
              onClick={() => onColor(name)}
            />
          );
        })}
      </div>
      <div className="pen-toolbar__thicknesses" role="group" aria-label="Pen thickness">
        {PEN_THICKNESS_NAMES.map((name: PenThickness) => {
          const label = PEN_THICKNESS_LABELS[name];
          return (
            <button
              key={name}
              type="button"
              className={`pen-toolbar__thickness${thickness === name ? ' pen-toolbar__thickness--active' : ''}`}
              data-testid={`pen-thickness-${name}`}
              data-thickness={name}
              aria-label={label}
              title={`${label} - ${PEN_THICKNESS_WORLD[name]} board units`}
              aria-pressed={thickness === name}
              disabled={disabled}
              onClick={() => onThickness(name)}
            >
              <span
                className="pen-toolbar__thickness-line"
                data-thickness={name}
                style={{ height: `${PEN_THICKNESS_WORLD[name]}px` }}
                aria-hidden="true"
              />
              <span className="pen-toolbar__label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
