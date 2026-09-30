import type { SyntheticEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

export function colorLabel(color: StickyColor): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

/** Toolbars must never let pointer input reach the note or the board. */
function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

/** Floating toolbar for the selected note: six colour swatches and a delete button. */
export function NoteToolbar(props: { color: StickyColor; onColor(c: StickyColor): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {COLOR_NAMES.map((color) => (
        <button
          key={color}
          type="button"
          className="swatch"
          aria-label={`${colorLabel(color)} colour`}
          aria-pressed={props.color === color}
          title={colorLabel(color)}
          style={{ backgroundColor: STICKY_COLORS[color] }}
          onClick={() => props.onColor(color)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button type="button" className="note-delete" aria-label="Delete note" title="Delete note" onClick={props.onDelete}>
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
    </div>
  );
}
