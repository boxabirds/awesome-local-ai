import type { CSSProperties } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

export const SHAPE_TOOLBAR_LABEL = 'Shape';
export const DELETE_SHAPE_LABEL = 'Delete shape';

function capitalise(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/** "Blue fill", and "No fill" for the empty swatch (accessible name and tooltip). */
export function fillLabel(c: FillColor): string {
  return c === 'none' ? 'No fill' : `${capitalise(c)} fill`;
}

/** "Red outline" (accessible name and tooltip). */
export function outlineLabel(c: StrokeColor): string {
  return `${capitalise(c)} outline`;
}

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export interface ShapeToolbarProps {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  /** Delete button (omitted when absent). */
  onDelete?(): void;
  /** Screen-space position (the selection bar places it above the shape). */
  style?: CSSProperties;
}

/**
 * Floating toolbar for one selected shape (shape.style): seven fill swatches (six colours and
 * no fill), six outline swatches (the current ones pressed) and Delete.
 */
export function ShapeToolbar({ fill, stroke, onFill, onStroke, onDelete, style }: ShapeToolbarProps) {
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label={SHAPE_TOOLBAR_LABEL}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {FILLS.map((name) => (
        <button
          key={name}
          type="button"
          className={`note-toolbar__swatch${name === 'none' ? ' shape-toolbar__swatch--none' : ''}`}
          aria-label={fillLabel(name)}
          title={fillLabel(name)}
          aria-pressed={name === fill}
          data-fill={name}
          style={{ backgroundColor: SHAPE_FILL_COLORS[name] }}
          onClick={() => onFill(name)}
        />
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      {STROKES.map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar__swatch shape-toolbar__outline"
          aria-label={outlineLabel(name)}
          title={outlineLabel(name)}
          aria-pressed={name === stroke}
          data-stroke={name}
          style={{ borderColor: SHAPE_STROKE_COLORS[name] }}
          onClick={() => onStroke(name)}
        />
      ))}
      {onDelete && (
        <>
          <span className="note-toolbar__divider" aria-hidden="true" />
          <button
            type="button"
            className="note-toolbar__delete"
            aria-label={DELETE_SHAPE_LABEL}
            title={DELETE_SHAPE_LABEL}
            onClick={onDelete}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
