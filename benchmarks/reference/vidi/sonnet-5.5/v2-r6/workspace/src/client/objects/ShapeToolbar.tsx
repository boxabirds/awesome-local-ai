import type { PointerEvent } from 'react';
import {
  SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor,
} from '../../shared/config';

const stop = (e: PointerEvent) => e.stopPropagation();

/** Fill (six colours and none) and outline (six colours) swatches for the selected shape. */
export function ShapeToolbar(props: {
  fill: FillColor; stroke: StrokeColor; onFill(c: FillColor): void; onStroke(c: StrokeColor): void; onDelete?(): void;
}) {
  return (
    <div
      className="note-toolbar shape-toolbar"
      role="toolbar"
      aria-label="Shape toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="swatch-group" role="group" aria-label="Fill">
        {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => {
          const name = c === 'none' ? 'no fill' : `${c} fill`;
          return (
            <button
              key={c}
              type="button"
              className={`note-swatch${c === 'none' ? ' swatch-none' : ''}`}
              aria-label={name}
              title={name}
              aria-pressed={props.fill === c}
              style={{ background: c === 'none' ? '#fff' : SHAPE_FILL_COLORS[c] }}
              onClick={() => props.onFill(c)}
            />
          );
        })}
      </div>
      <div className="swatch-group" role="group" aria-label="Outline">
        {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
          <button
            key={c}
            type="button"
            className="note-swatch swatch-outline"
            aria-label={`${c} outline`}
            title={`${c} outline`}
            aria-pressed={props.stroke === c}
            style={{ background: '#fff', borderColor: SHAPE_STROKE_COLORS[c] }}
            onClick={() => props.onStroke(c)}
          />
        ))}
      </div>
      {props.onDelete && (
        <button type="button" className="note-delete" aria-label="Delete shape" title="Delete shape" onClick={props.onDelete}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 7h12M9 7V5h6v2m-8 0 1 12h8l1-12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
