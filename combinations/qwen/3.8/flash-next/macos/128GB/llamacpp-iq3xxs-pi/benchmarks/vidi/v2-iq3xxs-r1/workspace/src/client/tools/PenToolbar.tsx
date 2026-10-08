import { useRef } from 'react';
import { useNativeStopPropagation } from '../board/useNativeStopPropagation';
import {
  PEN_COLOR_LABELS,
  PEN_COLORS,
  PEN_THICKNESS_LABELS,
  PEN_THICKNESS_WORLD,
  type PenColor,
  type PenThickness,
} from '../../shared/config';

export interface PenToolbarProps {
  /** What the next stroke will be drawn with. */
  color: PenColor;
  thickness: PenThickness;
  onColor(c: PenColor): void;
  onThickness(t: PenThickness): void;
}

export const PEN_TOOLBAR_LABEL = 'Pen';
export const PEN_COLOR_GROUP_LABEL = 'Pen colour';
export const PEN_THICKNESS_GROUP_LABEL = 'Pen thickness';

/** `button[aria-label="<colour> pen"]`, the accessible name the PRD's six inks have. */
export function penColorLabel(color: PenColor): string {
  return `${PEN_COLOR_LABELS[color]} pen`;
}

/** `button[aria-label="Thin|Medium|Thick"]`. */
export function penThicknessLabel(thickness: PenThickness): string {
  return PEN_THICKNESS_LABELS[thickness];
}

/** Which of the three buttons is which, in the order they are shown. */
export const PEN_THICKNESS_ORDER: readonly PenThickness[] = ['thin', 'medium', 'thick'];
export const PEN_COLOR_ORDER: readonly PenColor[] = [
  'black',
  'blue',
  'red',
  'green',
  'orange',
  'purple',
];

/**
 * The pen's own settings, shown while the Pen tool is active (PRD pen.options).
 *
 * Six inks and three thicknesses, and nothing else: no line style, no fill, no
 * opacity. What is picked here belongs to this tab and to the next stroke — it is not
 * written to the document, it does not restyle anything already drawn, and a reload
 * brings the defaults back.
 */
export function PenToolbar({ color, thickness, onColor, onThickness }: PenToolbarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);
  return (
    <div
      ref={ref}
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label={PEN_TOOLBAR_LABEL}
    >
      <div className="pen-group" role="group" aria-label={PEN_COLOR_GROUP_LABEL}>
        {PEN_COLOR_ORDER.map((name) => (
          <button
            key={name}
            type="button"
            className="pen-swatch"
            data-testid={`pen-color-${name}`}
            data-pen-color={name}
            aria-label={penColorLabel(name)}
            title={penColorLabel(name)}
            aria-pressed={color === name}
            style={{ background: PEN_COLORS[name] }}
            onClick={() => onColor(name)}
          />
        ))}
      </div>
      <div className="pen-group pen-thickness-group" role="group" aria-label={PEN_THICKNESS_GROUP_LABEL}>
        {PEN_THICKNESS_ORDER.map((name) => (
          <button
            key={name}
            type="button"
            className="tool-button pen-thickness"
            data-testid={`pen-thickness-${name}`}
            data-pen-thickness={name}
            aria-label={penThicknessLabel(name)}
            title={`${penThicknessLabel(name)} – ${PEN_THICKNESS_WORLD[name]} board units`}
            aria-pressed={thickness === name}
            onClick={() => onThickness(name)}
          >
            <span
              className="pen-thickness-sample"
              aria-hidden="true"
              style={{ height: `${PEN_THICKNESS_WORLD[name]}px` }}
            />
            {penThicknessLabel(name)}
          </button>
        ))}
      </div>
    </div>
  );
}
