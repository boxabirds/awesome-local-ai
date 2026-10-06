/**
 * The bar of the selected shape (story 10): fill swatches, outline swatches, and the bin.
 *
 * Like the note's bar it lives inside the shape element and is counter-scaled by the board zoom, so
 * it stays the same size on screen whatever the zoom. Swatches are named buttons, not coloured
 * squares to be told apart by eye: "blue fill" and "dark outline" say which of the two a button
 * paints, which is the one thing a swatch cannot show by itself.
 */
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

export interface ShapeToolbarProps {
  /** The shape's current fill, shown as pressed. */
  fill: FillColor;
  /** The shape's current outline, shown as pressed. */
  stroke: StrokeColor;
  /**
   * False while the board could not be loaded (story 4): the swatches are disabled rather than
   * hidden, so the bar does not rearrange itself around a problem.
   */
  canEdit?: boolean;
  onFill(fill: FillColor): void;
  onStroke(stroke: StrokeColor): void;
  onDelete(): void;
}

/** A swatch that paints nothing, said out loud: the "no fill" option is a hollow square. */
export function fillLabel(name: FillColor): string {
  return `${name} fill`;
}

export function strokeLabel(name: StrokeColor): string {
  return `${name} outline`;
}

function stopPropagation(
  event: ReactPointerEvent | ReactMouseEvent,
): void {
  // a click on the bar is not a click on the board, which would clear the selection
  event.stopPropagation();
}

export function ShapeToolbar({
  fill,
  stroke,
  canEdit = true,
  onFill,
  onStroke,
  onDelete,
}: ShapeToolbarProps): JSX.Element {
  return (
    <div
      className="shape-object__toolbar"
      data-shape-toolbar
      data-testid="shape-toolbar"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="shape-object__swatch"
          data-fill-swatch={name}
          style={{ background: SHAPE_FILL_COLORS[name] }}
          aria-label={fillLabel(name)}
          title={fillLabel(name)}
          disabled={!canEdit}
          aria-pressed={fill === name}
          onClick={() => {
            onFill(name);
          }}
        />
      ))}
      <span className="shape-object__toolbar-divider" aria-hidden="true" />
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="shape-object__swatch shape-object__swatch--line"
          data-stroke-swatch={name}
          style={{ borderColor: SHAPE_STROKE_COLORS[name] }}
          aria-label={strokeLabel(name)}
          title={strokeLabel(name)}
          disabled={!canEdit}
          aria-pressed={stroke === name}
          onClick={() => {
            onStroke(name);
          }}
        />
      ))}
      <button
        type="button"
        className="shape-object__delete"
        data-testid="shape-delete"
        aria-label="Delete shape"
        title="Delete shape"
        disabled={!canEdit}
        onClick={() => {
          onDelete();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3H13a.75.75 0 0 1 0 1.5h-.35l-.55 8.1A1.75 1.75 0 0 1 10.36 14.3H5.64a1.75 1.75 0 0 1-1.74-1.7L3.35 4.5H3A.75.75 0 0 1 3 3h2.25v-.75A.75.75 0 0 1 6 1.5Zm1.5 1.5v-.5h1v.5h-1ZM5 4.5l.5 7.6h5L11 4.5H5Z"
          />
        </svg>
      </button>
    </div>
  );
}
