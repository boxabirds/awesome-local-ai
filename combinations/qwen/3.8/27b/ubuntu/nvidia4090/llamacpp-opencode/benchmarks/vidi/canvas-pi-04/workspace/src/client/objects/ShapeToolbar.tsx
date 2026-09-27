// Story 10: the floating toolbar for a selected shape (anchor: shape.style):
// fill swatches, outline swatches and a delete button, positioned above the
// shape in screen space (counter-scaled by the SelectionBar parent).

import type { JSX } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

const FILL_NAMES = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_NAMES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

function colorLabel(color: string): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill: (fill: FillColor) => void;
  onStroke: (stroke: StrokeColor) => void;
  onDelete: () => void;
  /** When true (board load_failed) the tools are inert. */
  disabled?: boolean;
}): JSX.Element {
  const disabled = props.disabled === true;
  const stop = (e: ReactPointerEvent | ReactMouseEvent): void => {
    e.stopPropagation();
  };
  return (
    <div
      className="shape-toolbar"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={stop}
      onDoubleClick={stop}
      onClick={stop}
    >
      <div className="shape-toolbar__row" role="group" aria-label="Fill colour">
        {FILL_NAMES.map((fill) => (
          <button
            key={fill}
            type="button"
            className="shape-toolbar__swatch shape-toolbar__swatch--fill"
            title={`${colorLabel(fill)} fill`}
            aria-label={`${colorLabel(fill)} fill`}
            aria-pressed={props.fill === fill}
            disabled={disabled}
            style={{ background: SHAPE_FILL_COLORS[fill] }}
            onClick={() => props.onFill(fill)}
          />
        ))}
      </div>
      <div className="shape-toolbar__row" role="group" aria-label="Outline colour">
        {STROKE_NAMES.map((stroke) => (
          <button
            key={stroke}
            type="button"
            className="shape-toolbar__swatch shape-toolbar__swatch--stroke"
            title={`${colorLabel(stroke)} outline`}
            aria-label={`${colorLabel(stroke)} outline`}
            aria-pressed={props.stroke === stroke}
            disabled={disabled}
            style={{ background: SHAPE_STROKE_COLORS[stroke] }}
            onClick={() => props.onStroke(stroke)}
          />
        ))}
      </div>
      <button
        type="button"
        className="shape-toolbar__delete"
        title="Delete shape"
        aria-label="Delete shape"
        disabled={disabled}
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M5 2V1h6v1h4v1.5H1V2h4zm-1 3.5h8l-.6 8.2a1 1 0 0 1-1 .98H4.6a1 1 0 0 1-1-.98L4 5.5zm2.2 1.4.35 6.1h.95l.2-6.1H6.2zm2.3 0 .2 6.1h.95l.35-6.1h-1.5z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
