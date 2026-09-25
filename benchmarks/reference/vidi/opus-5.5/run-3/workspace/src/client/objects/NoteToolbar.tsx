import type { SyntheticEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

export function colourLabel(c: StickyColor): string {
  return `${c.charAt(0).toUpperCase()}${c.slice(1)} colour`;
}

// Keep pointer and double-click events away from the note (drag, edit) and the board (deselect, create).
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Colour swatches and delete button for the selected note. */
export function NoteToolbar(props: { color: StickyColor; onColor(c: StickyColor): void; onDelete(): void }) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note"
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {COLOR_NAMES.map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar__swatch"
          aria-label={colourLabel(c)}
          aria-pressed={props.color === c}
          title={colourLabel(c)}
          style={{ backgroundColor: STICKY_COLORS[c] }}
          onClick={() => props.onColor(c)}
        />
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5"
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
