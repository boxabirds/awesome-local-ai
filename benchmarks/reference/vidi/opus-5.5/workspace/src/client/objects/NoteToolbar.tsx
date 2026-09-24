import type { CSSProperties } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export const DELETE_NOTE_LABEL = 'Delete note';

/** "yellow" → "Yellow colour" (the swatch's accessible name and tooltip). */
export function colourLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
  /** Screen-space position (the parent places it above the note). */
  style?: CSSProperties;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** Floating toolbar for the selected note: six colour swatches and a delete (bin) button. */
export function NoteToolbar({ color, onColor, onDelete, style }: NoteToolbarProps) {
  return (
    <div
      className="note-toolbar"
      role="toolbar"
      aria-label="Note"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar__swatch"
          aria-label={colourLabel(name)}
          title={colourLabel(name)}
          aria-pressed={name === color}
          style={{ backgroundColor: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar__delete"
        aria-label={DELETE_NOTE_LABEL}
        title={DELETE_NOTE_LABEL}
        onClick={onDelete}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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
