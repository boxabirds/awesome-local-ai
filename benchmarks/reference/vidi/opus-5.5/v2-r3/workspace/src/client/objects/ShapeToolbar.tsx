import type { SyntheticEvent } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

function capitalise(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "Blue fill", "No fill". */
export function fillLabel(c: FillColor): string {
  return c === 'none' ? 'No fill' : `${capitalise(c)} fill`;
}

/** "Red outline". */
export function strokeLabel(c: StrokeColor): string {
  return `${capitalise(c)} outline`;
}

/** Toolbars must never let pointer input reach the shape or the board. */
function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * Toolbar for exactly one selected shape (shape.style): six fill colours plus
 * no fill, six outline colours, and delete.
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
      aria-label="Shape"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {FILLS.map((c) => (
        <button
          key={c}
          type="button"
          className={`swatch${c === 'none' ? ' swatch-none' : ''}`}
          aria-label={fillLabel(c)}
          aria-pressed={props.fill === c}
          title={fillLabel(c)}
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
          aria-pressed={props.stroke === c}
          title={strokeLabel(c)}
          style={{ borderColor: SHAPE_STROKE_COLORS[c] }}
          onClick={() => props.onStroke(c)}
        />
      ))}
      {props.onDelete && (
        <>
          <span className="note-toolbar-divider" aria-hidden="true" />
          <DeleteButton label="Delete shape" onClick={props.onDelete} />
        </>
      )}
    </div>
  );
}

export function DeleteButton(props: { label: string; onClick(): void }) {
  return (
    <button type="button" className="note-delete" aria-label={props.label} title={props.label} onClick={props.onClick}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M6 2h4M2.5 4h11M4 4l.7 9.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L12 4M6.5 6.5v5M9.5 6.5v5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** Toolbar for exactly one selected arrow: delete only (arrows have no styling in this story). */
export function ConnectorToolbar(props: { onDelete(): void }) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Arrow"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      <DeleteButton label="Delete arrow" onClick={props.onDelete} />
    </div>
  );
}
