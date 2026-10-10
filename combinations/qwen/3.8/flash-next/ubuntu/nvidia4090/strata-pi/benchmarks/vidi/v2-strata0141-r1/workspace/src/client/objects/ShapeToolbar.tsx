import { useCallback } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_FILL_NAMES,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_NAMES,
  shapeFillLabel,
  shapeStrokeLabel,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';

/**
 * The toolbar above a selected shape: its fill, its outline and a delete button
 * (anchor `shape.colours`, TC-17).
 *
 * A colour is a **named key**, and the button that chooses it is labelled with
 * that name - `blue fill`, `red outline`, `no fill` - so the two halves of
 * `shape.colours` are two separate choices and neither is a guess. Selecting one
 * leaves the selection alone: recolouring is done to the shape that is already
 * selected, and the toolbar has to stay where it is for the next colour.
 *
 * Like every board toolbar it is `data-board-chrome`, and it stops pointer events
 * so a click on a swatch never reaches the viewport (which would clear the
 * selection).
 */
export interface ShapeToolbarProps {
  fill: ShapeFillColor;
  stroke: ShapeStrokeColor;
  onFill(fill: ShapeFillColor): void;
  onStroke(stroke: ShapeStrokeColor): void;
  onDelete(): void;
}

export function ShapeToolbar(props: ShapeToolbarProps) {
  const { fill, stroke, onFill, onStroke, onDelete } = props;

  const stop = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation();
  }, []);

  return (
    <div
      className="shape-toolbar"
      data-testid="shape-toolbar"
      data-board-chrome="true"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      <div className="shape-toolbar__colours" data-testid="shape-fill-swatches">
        {SHAPE_FILL_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="shape-toolbar__swatch"
            data-testid={`fill-${name}`}
            data-colour={name}
            style={{ background: SHAPE_FILL_COLORS[name] }}
            aria-label={shapeFillLabel(name)}
            aria-pressed={fill === name}
            title={shapeFillLabel(name)}
            onClick={() => {
              onFill(name);
            }}
          />
        ))}
      </div>
      <div className="shape-toolbar__colours" data-testid="shape-stroke-swatches">
        {SHAPE_STROKE_NAMES.map((name) => (
          <button
            key={name}
            type="button"
            className="shape-toolbar__swatch shape-toolbar__swatch--outline"
            data-testid={`stroke-${name}`}
            data-colour={name}
            style={{ borderColor: SHAPE_STROKE_COLORS[name] }}
            aria-label={shapeStrokeLabel(name)}
            aria-pressed={stroke === name}
            title={shapeStrokeLabel(name)}
            onClick={() => {
              onStroke(name);
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="shape-toolbar__delete"
        data-testid="delete-shape"
        aria-label="Delete shape"
        title="Delete shape"
        onClick={() => {
          onDelete();
        }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path
            d="M6 7h12M10 7V5h4v2M9 7v11h6V7M11 10v5M13 10v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <span className="visually-hidden">Delete shape</span>
      </button>
    </div>
  );
}
