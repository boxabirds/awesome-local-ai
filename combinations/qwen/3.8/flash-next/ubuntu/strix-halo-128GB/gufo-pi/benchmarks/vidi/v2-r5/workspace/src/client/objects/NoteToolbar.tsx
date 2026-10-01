import type React from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  /** Currently applied colour, reported through `aria-pressed`. */
  color: StickyColor;
  /** Screen-space scale compensation: the toolbar lives in the zoomed world layer. */
  zoom?: number;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Accessible name / tooltip of a colour swatch: the colour name, e.g. "Pink". */
export const colorLabel = (color: StickyColor): string =>
  `${color.charAt(0).toUpperCase()}${color.slice(1)}`;

/**
 * The floating toolbar of the selected note: six colour swatches and a delete (bin) button,
 * centred above the note.
 *
 * It sits inside the note element, so it is counter-scaled by `1 / zoom` — the note grows with
 * the board, the toolbar keeps a constant size on screen. Every pointer event stops here, so a
 * click on a swatch never reaches the viewport (which would clear the selection).
 */
export function NoteToolbar({ color, zoom = 1, onColor, onDelete }: NoteToolbarProps) {
  const stop = (event: React.SyntheticEvent): void => {
    event.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      style={{ transform: `scale(${1 / (zoom || 1)})`, transformOrigin: 'bottom left' }}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onDoubleClick={stop}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={colorLabel(name)}
          title={colorLabel(name)}
          aria-pressed={name === color}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-toolbar-delete"
        data-testid="note-toolbar-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4l.6 1H13v1.5H3V3h2.4L6 2Zm-1 4h1.2l.3 6.2h-1.2L5 6Zm3.4 0h1.2v6.2H8.4V6Zm2.4 0H11l-.3 6.2h-1.2L10.8 6ZM4 13.5h8V15H4v-1.5Z"
          />
        </svg>
      </button>
    </div>
  );
}
