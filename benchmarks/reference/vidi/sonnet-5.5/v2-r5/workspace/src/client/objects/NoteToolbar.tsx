import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];
const label = (c: StickyColor) => c[0].toUpperCase() + c.slice(1);

export function NoteToolbar(props: { color: StickyColor; onColor(c: StickyColor): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          type="button"
          className="swatch"
          aria-label={`${label(c)} colour`}
          title={`${label(c)} colour`}
          aria-pressed={props.color === c}
          style={{ background: STICKY_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <button type="button" className="note-delete" aria-label="Delete note" title="Delete note" onClick={props.onDelete}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
        </svg>
      </button>
    </div>
  );
}
