// Story 11: the pen options toolbar (anchor: pen.options).
//
// Visible only while the Pen tool is active (rendered by App in the screen-
// space board overlay, next to the left toolbar). Six colour swatches and
// three thickness buttons; the active choice is pressed. Changing a choice
// never touches strokes already drawn — it only affects subsequent strokes.
// Pointer/double-click/stopPropagation keep board gestures (pan, marquee,
// create) from starting on the toolbar.

import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { PEN_COLORS, PEN_THICKNESS_WORLD, type PenColor, type PenThickness } from '../../shared/config';

const COLORS: readonly PenColor[] = ['black', 'blue', 'red', 'green', 'orange', 'purple'];
const THICKNESS_ORDER: readonly PenThickness[] = ['thin', 'medium', 'thick'];

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

export function PenToolbar(props: {
  color: PenColor;
  thickness: PenThickness;
  onColor: (color: PenColor) => void;
  onThickness: (thickness: PenThickness) => void;
}): JSX.Element {
  const stop = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.stopPropagation();
  };
  return (
    <div
      className="pen-toolbar"
      data-testid="pen-toolbar"
      role="toolbar"
      aria-label="Pen options"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
    >
      <div className="pen-toolbar__colours" aria-label="Colour">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className="pen-toolbar__swatch"
            title={`${COLOR_LABELS[color]} pen`}
            aria-label={`${COLOR_LABELS[color]} pen`}
            aria-pressed={props.color === color}
            onClick={() => props.onColor(color)}
          >
            <span
              className="pen-toolbar__swatch-dot"
              style={{ background: PEN_COLORS[color] }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
      <div className="pen-toolbar__divider" aria-hidden="true" />
      <div className="pen-toolbar__thickness" aria-label="Thickness">
        {THICKNESS_ORDER.map((thickness) => (
          <button
            key={thickness}
            type="button"
            className="pen-toolbar__thickness-btn"
            title={`${THICKNESS_LABELS[thickness]} (${PEN_THICKNESS_WORLD[thickness]})`}
            aria-label={THICKNESS_LABELS[thickness]}
            aria-pressed={props.thickness === thickness}
            onClick={() => props.onThickness(thickness)}
          >
            <span
              className="pen-toolbar__thickness-dot"
              style={{ width: PEN_THICKNESS_WORLD[thickness], height: PEN_THICKNESS_WORLD[thickness] }}
              aria-hidden="true"
            />
            {THICKNESS_LABELS[thickness]}
          </button>
        ))}
      </div>
    </div>
  );
}
