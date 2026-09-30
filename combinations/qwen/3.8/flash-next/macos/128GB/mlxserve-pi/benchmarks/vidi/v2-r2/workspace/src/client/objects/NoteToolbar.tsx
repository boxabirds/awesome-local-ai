// The small toolbar that floats above the selected note: six colours and a bin.
// It is shown for the selected note only, and hidden while that note is being
// dragged or typed in, so it never covers the text being written.
//
// Swatches are named, not just coloured: the accessible name and tooltip say
// "Green colour", which is what makes two similar colours tellable apart.

import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** The order the swatches appear in: the PRD's list. */
export const SWATCH_ORDER: readonly StickyColor[] = [
  'yellow',
  'orange',
  'green',
  'blue',
  'pink',
  'violet',
];

/** "green" -> "Green", for accessible names and tooltips. */
export function colorLabel(color: StickyColor): string {
  return `${color.charAt(0).toUpperCase()}${color.slice(1)}`;
}

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      // A press on a swatch is a click on UI, never a drag of the note under it
      // and never a click on the board (which would deselect the note).
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {SWATCH_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="sticky-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          style={{ background: STICKY_COLORS[name] }}
          aria-label={`${colorLabel(name)} colour`}
          title={`${colorLabel(name)} colour`}
          aria-pressed={name === color}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="sticky-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note (Delete)"
        onClick={onDelete}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5"
          />
        </svg>
      </button>
    </div>
  );
}
