import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';

const FILLS = Object.keys(SHAPE_FILL_COLORS) as FillColor[];
const STROKES = Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[];

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
      aria-label="Shape tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="swatch-row" role="group" aria-label="Fill">
        {FILLS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c === 'none' ? ' swatch--none' : ''}`}
            aria-label={`${c} fill`}
            title={c === 'none' ? 'No fill' : `${c} fill`}
            aria-pressed={props.fill === c}
            style={c === 'none' ? undefined : { background: SHAPE_FILL_COLORS[c] }}
            onClick={() => props.onFill(c)}
          />
        ))}
      </div>
      <div className="swatch-row" role="group" aria-label="Outline">
        {STROKES.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch swatch--outline"
            aria-label={`${c} outline`}
            title={`${c} outline`}
            aria-pressed={props.stroke === c}
            style={{ background: SHAPE_STROKE_COLORS[c] }}
            onClick={() => props.onStroke(c)}
          />
        ))}
      </div>
      {props.onDelete && (
        <button type="button" className="note-delete" aria-label="Delete shape" title="Delete shape" onClick={props.onDelete}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
        </button>
      )}
    </div>
  );
}
