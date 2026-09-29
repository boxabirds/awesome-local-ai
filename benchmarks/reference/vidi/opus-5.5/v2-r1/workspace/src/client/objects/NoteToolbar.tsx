import type { SyntheticEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** "pink" → "Pink colour". */
export function colourLabel(color: StickyColor): string {
  return `${color[0].toUpperCase()}${color.slice(1)} colour`;
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Colour swatches and delete button for the selected note. */
export function NoteToolbar(props: {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
}) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      onPointerDown={stop}
      onPointerUp={stop}
      onDoubleClick={stop}
    >
      {COLOR_NAMES.map((color) => (
        <button
          key={color}
          type="button"
          className="swatch"
          aria-label={colourLabel(color)}
          title={colourLabel(color)}
          aria-pressed={props.color === color}
          style={{ backgroundColor: STICKY_COLORS[color] }}
          onClick={() => props.onColor(color)}
        />
      ))}
      <span className="note-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={props.onDelete}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
