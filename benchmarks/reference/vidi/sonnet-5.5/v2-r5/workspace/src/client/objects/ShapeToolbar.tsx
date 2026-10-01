import {
  SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor,
} from '../../shared/config';

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

export function ShapeToolbar(props: {
  fill: FillColor; stroke: StrokeColor; onFill(c: FillColor): void; onStroke(c: StrokeColor): void;
  onDelete?(): void;
}) {
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="swatch-group" role="group" aria-label="Fill">
        {FILLS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c === 'none' ? ' swatch-none' : ''}`}
            aria-label={c === 'none' ? 'no fill' : `${c} fill`}
            title={c === 'none' ? 'No fill' : `${c} fill`}
            aria-pressed={props.fill === c}
            style={c === 'none' ? undefined : { background: SHAPE_FILL_COLORS[c] }}
            onClick={() => props.onFill(c)}
          />
        ))}
      </div>
      <div className="swatch-group" role="group" aria-label="Outline">
        {STROKES.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch swatch-outline"
            aria-label={`${c} outline`}
            title={`${c} outline`}
            aria-pressed={props.stroke === c}
            style={{ borderColor: SHAPE_STROKE_COLORS[c] }}
            onClick={() => props.onStroke(c)}
          />
        ))}
      </div>
      {props.onDelete && (
        <button type="button" className="note-delete" aria-label="Delete shape" title="Delete shape" onClick={props.onDelete}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
          </svg>
        </button>
      )}
    </div>
  );
}
