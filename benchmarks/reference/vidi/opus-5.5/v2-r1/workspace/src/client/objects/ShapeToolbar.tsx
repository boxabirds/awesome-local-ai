import type { SyntheticEvent } from 'react';
import {
  type FillColor,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type StrokeColor,
} from '../../shared/config';

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

/** "blue" → "blue fill"; "none" → "none fill" (no fill). */
export const fillLabel = (c: FillColor) => `${c} fill`;
/** "red" → "red outline". */
export const strokeLabel = (c: StrokeColor) => `${c} outline`;

const stop = (e: SyntheticEvent) => e.stopPropagation();

/**
 * Fill (six colours and no fill) and outline (six colours) swatches for the selected shape
 * (story 10), with a delete button like the other single-object toolbars.
 */
export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  onDelete?(): void;
}) {
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label="Shape toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {FILLS.map((c) => (
        <button
          key={c}
          type="button"
          className={c === 'none' ? 'swatch swatch-none' : 'swatch'}
          aria-label={fillLabel(c)}
          title={c === 'none' ? 'No fill' : `${c[0].toUpperCase()}${c.slice(1)} fill`}
          aria-pressed={props.fill === c}
          style={{ backgroundColor: SHAPE_FILL_COLORS[c] }}
          onClick={() => props.onFill(c)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      {STROKES.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch swatch-outline"
          aria-label={strokeLabel(c)}
          title={`${c[0].toUpperCase()}${c.slice(1)} outline`}
          aria-pressed={props.stroke === c}
          style={{ borderColor: SHAPE_STROKE_COLORS[c] }}
          onClick={() => props.onStroke(c)}
        />
      ))}
      {props.onDelete && (
        <>
          <span className="note-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="note-toolbar-delete"
            aria-label="Delete shape"
            title="Delete shape"
            onClick={props.onDelete}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
