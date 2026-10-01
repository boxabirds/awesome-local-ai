import { STICKY_COLORS } from '../../shared/config';
import type { StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

function label(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

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
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        </svg>
      </button>
    </div>
  );
}
