// Floating toolbar for the selected note (see spec: sticky.toolbar).
// Rendered in screen space above the note (does not scale with zoom); hidden
// while the note is dragging or editing (by App).

import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

function labelFor(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      data-testid="note-toolbar"
      className="note-toolbar"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          className="note-toolbar-swatch"
          aria-label={labelFor(c)}
          title={labelFor(c)}
          aria-pressed={color === c}
          style={{ background: STICKY_COLORS[c] }}
          onClick={() => onColor(c)}
        />
      ))}
      <button
        type="button"
        className="note-toolbar-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M5.5 2h5l.5 1.5h3v1.5h-11V3.5h3L5.5 2zM3 6.5h10l-.7 7a1 1 0 0 1-1 .9H4.7a1 1 0 0 1-1-.9l-.7-7zm3.2 2v4h1.2V8.5H6.2zm2.4 0v4h1.2V8.5H8.6z"
            fill="currentColor"
          />
        </svg>
      </button>
    </div>
  );
}
