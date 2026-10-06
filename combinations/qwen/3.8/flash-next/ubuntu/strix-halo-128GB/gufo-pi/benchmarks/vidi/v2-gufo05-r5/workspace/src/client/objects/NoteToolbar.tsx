/**
 * The floating toolbar of the selected note: the six colours and the bin.
 *
 * It lives inside the note element but is counter-scaled by the board zoom, so it keeps
 * a constant size on screen and never scales with the note.
 */
import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  /** The note's current colour, shown as pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** The palette in the order the swatches appear. */
export const STICKY_COLOR_ORDER: readonly StickyColor[] = Object.keys(STICKY_COLORS) as StickyColor[];

/** "yellow" -> "Yellow colour": a name, so swatches are not told apart by colour alone. */
export function stickyColorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)} colour`;
}

function stopPropagation(event: { stopPropagation(): void }): void {
  // a click on the toolbar is not a click on the board (which would clear the selection)
  event.stopPropagation();
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="sticky-note__toolbar"
      data-note-toolbar
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="sticky-note__swatch"
          data-swatch={name}
          style={{ background: STICKY_COLORS[name] }}
          aria-label={stickyColorLabel(name)}
          title={stickyColorLabel(name)}
          aria-pressed={color === name}
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="sticky-note__delete"
        data-testid="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={() => {
          onDelete();
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3H13a.75.75 0 0 1 0 1.5h-.35l-.55 8.1A1.75 1.75 0 0 1 10.36 14.3H5.64a1.75 1.75 0 0 1-1.74-1.7L3.35 4.5H3A.75.75 0 0 1 3 3h2.25v-.75A.75.75 0 0 1 6 1.5Zm1.5 1.5v-.5h1v.5h-1ZM5 4.5l.5 7.6h5L11 4.5H5Z"
          />
        </svg>
      </button>
    </div>
  );
}
