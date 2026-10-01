import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, type FillColor, type StrokeColor } from '../../shared/config';

const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

function Swatch(props: { label: string; color: string; none?: boolean; active: boolean; outline?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
      style={{
        width: 22,
        height: 22,
        padding: 0,
        boxSizing: 'border-box',
        borderRadius: props.outline ? '50%' : 4,
        cursor: 'pointer',
        border: props.outline ? `4px solid ${props.color}` : '1px solid #888',
        background: props.outline ? '#fff' : props.none ? 'linear-gradient(135deg, #fff 45%, #e53935 45%, #e53935 55%, #fff 55%)' : props.color,
        boxShadow: props.active ? '0 0 0 2px #1e88e5' : 'none',
      }}
    />
  );
}

/** Fill and outline swatches for exactly one selected shape. */
export function ShapeToolbar(props: { fill: FillColor; stroke: StrokeColor; onFill(c: FillColor): void; onStroke(c: StrokeColor): void; onDelete?(): void }) {
  return (
    <div
      role="toolbar"
      aria-label="Shape tools"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.25)', whiteSpace: 'nowrap' }}
    >
      {(Object.keys(SHAPE_FILL_COLORS) as FillColor[]).map((c) => (
        <Swatch key={c} label={c === 'none' ? 'no fill' : `${c} fill`} color={SHAPE_FILL_COLORS[c]} none={c === 'none'} active={props.fill === c} onClick={() => props.onFill(c)} />
      ))}
      <span aria-hidden="true" style={{ width: 1, height: 18, background: '#ccc' }} />
      {(Object.keys(SHAPE_STROKE_COLORS) as StrokeColor[]).map((c) => (
        <Swatch key={c} label={`${c} outline`} color={SHAPE_STROKE_COLORS[c]} outline active={props.stroke === c} onClick={() => props.onStroke(c)} />
      ))}
      {props.onDelete && (
        <button type="button" aria-label="Delete shape" title="Delete shape" onClick={props.onDelete} style={{ width: 26, height: 26, border: 'none', background: 'transparent', cursor: 'pointer', padding: 2 }}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
          </svg>
        </button>
      )}
    </div>
  );
}
