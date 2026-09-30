import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

function capitalise(name: string): string {
  return `${name[0]!.toUpperCase()}${name.slice(1)}`;
}

/** Accessible name of a fill swatch: "No fill", "Blue fill", … */
export function fillLabel(c: FillColor): string {
  return c === 'none' ? 'No fill' : `${capitalise(c)} fill`;
}

/** Accessible name of an outline swatch: "Dark outline", "Red outline", … */
export function strokeLabel(c: StrokeColor): string {
  return `${capitalise(c)} outline`;
}

/** Floating toolbar for one selected shape: fill swatches (six colours and no fill), outline swatches, Delete. */
export function ShapeToolbar(props: {
  fill: FillColor;
  stroke: StrokeColor;
  onFill(c: FillColor): void;
  onStroke(c: StrokeColor): void;
  onDelete?(): void;
}): React.JSX.Element {
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label="Shape"
      // Clicks here must never reach the board or the shape (clear selection, drag, edit).
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {FILLS.map((c) => (
        <button
          key={c}
          type="button"
          className={c === 'none' ? 'note-toolbar-swatch shape-swatch-none' : 'note-toolbar-swatch'}
          aria-label={fillLabel(c)}
          title={fillLabel(c)}
          aria-pressed={props.fill === c}
          data-fill={c}
          style={{ backgroundColor: SHAPE_FILL_COLORS[c] }}
          onClick={() => props.onFill(c)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      {STROKES.map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar-swatch shape-swatch-outline"
          aria-label={strokeLabel(c)}
          title={strokeLabel(c)}
          aria-pressed={props.stroke === c}
          data-stroke={c}
          style={{ borderColor: SHAPE_STROKE_COLORS[c] }}
          onClick={() => props.onStroke(c)}
        />
      ))}
      {props.onDelete && (
        <>
          <span className="note-toolbar-divider" aria-hidden="true" />
          <button type="button" className="note-toolbar-delete" aria-label="Delete shape" title="Delete shape" onClick={props.onDelete}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v8h1.5v-8H10Zm3.5 0v8H15v-8h-1.5Z"
                fill="currentColor"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
