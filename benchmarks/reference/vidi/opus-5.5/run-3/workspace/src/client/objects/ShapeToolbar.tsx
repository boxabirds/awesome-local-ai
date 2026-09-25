import type { SyntheticEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function fillLabel(c: FillColor): string {
  return `${c} fill`;
}

export function outlineLabel(c: StrokeColor): string {
  return `${c} outline`;
}

// Keep pointer and double-click events away from the shape (drag, edit) and the board (deselect, create).
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Fill swatches (six colours and no fill) and outline swatches (six colours) for the one selected shape. */
export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
}) {
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label="Shape"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {FILLS.map((c) => (
        <button
          key={c}
          type="button"
          className={`note-toolbar__swatch${c === 'none' ? ' shape-toolbar__swatch--none' : ''}`}
          aria-label={fillLabel(c)}
          aria-pressed={props.fill === c}
          title={c === 'none' ? 'No fill' : `${c.charAt(0).toUpperCase()}${c.slice(1)} fill`}
          style={{ backgroundColor: SHAPE_FILL_COLORS[c] }}
          onClick={() => props.onFill(c)}
        />
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      {STROKES.map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar__swatch shape-toolbar__outline"
          aria-label={outlineLabel(c)}
          aria-pressed={props.stroke === c}
          title={`${c.charAt(0).toUpperCase()}${c.slice(1)} outline`}
          style={{ borderColor: SHAPE_STROKE_COLORS[c] }}
          onClick={() => props.onStroke(c)}
        />
      ))}
    </div>
  );
}
