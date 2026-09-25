/**
 * Toolbar of a single selected shape (anchor: shape.style): six fill swatches plus No fill,
 * six outline swatches, and Delete. Like the note toolbar it never lets pointer input reach
 * the board or the shape underneath; keys reach the board (tool shortcuts keep working).
 */
import type { SyntheticEvent } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

const FILL_NAMES: Record<FillColor, string> = {
  none: 'No',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
  yellow: 'Yellow',
  pink: 'Pink',
  grey: 'Grey',
};

const STROKE_NAMES: Record<StrokeColor, string> = {
  dark: 'Dark',
  blue: 'Blue',
  green: 'Green',
  orange: 'Orange',
  red: 'Red',
  grey: 'Grey',
};

/** "Blue fill", "No fill". */
export function fillLabel(c: FillColor): string {
  return `${FILL_NAMES[c]} fill`;
}

/** "Red outline". */
export function outlineLabel(c: StrokeColor): string {
  return `${STROKE_NAMES[c]} outline`;
}

const FILL_ORDER = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKE_ORDER = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  onDelete?(): void;
}): React.JSX.Element {
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label="Shape"
      data-testid="shape-toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      onWheel={stop}
    >
      {FILL_ORDER.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch${c === 'none' ? ' swatch-none' : ''}`}
          aria-label={fillLabel(c)}
          title={fillLabel(c)}
          aria-pressed={props.fill === c}
          style={{ backgroundColor: SHAPE_FILL_COLORS[c] }}
          onClick={() => props.onFill(c)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      {STROKE_ORDER.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch swatch-outline"
          aria-label={outlineLabel(c)}
          title={outlineLabel(c)}
          aria-pressed={props.stroke === c}
          style={{ borderColor: SHAPE_STROKE_COLORS[c] }}
          onClick={() => props.onStroke(c)}
        />
      ))}
      {props.onDelete !== undefined && (
        <>
          <span className="note-toolbar-divider" aria-hidden="true" />
          <button type="button" className="note-delete" aria-label="Delete shape" title="Delete shape" onClick={props.onDelete}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"
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
