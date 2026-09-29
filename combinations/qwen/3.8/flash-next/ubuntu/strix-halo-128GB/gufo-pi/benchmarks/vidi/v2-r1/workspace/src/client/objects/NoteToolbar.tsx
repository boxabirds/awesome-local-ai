import type { JSX } from 'react';

import {
  STICKY_COLORS,
  stickyColorLabel,
  type StickyColor,
} from '../../shared/config';

/** The six preset colours, in the order the toolbar shows them. */
export const STICKY_COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  /** The note's current colour, shown as the pressed swatch. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * The floating toolbar of the selected note: six colour swatches and a bin
 * button.
 *
 * Every swatch is named ("Green colour") in its accessible name and tooltip, so
 * the colours are distinguishable without seeing them, and the current colour is
 * marked with `aria-pressed` as well as by the outline.
 *
 * Pointer events stop here: a click on the toolbar must not reach the board,
 * which would clear the selection and hide the toolbar.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note tools"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {STICKY_COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-toolbar__swatch"
          data-testid={`color-${name}`}
          data-color={name}
          aria-label={`${stickyColorLabel(name)} colour`}
          title={`${stickyColorLabel(name)} colour`}
          aria-pressed={name === color}
          style={{ background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <span className="note-toolbar__divider" aria-hidden="true" />
      <button
        type="button"
        className="note-toolbar__delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3h2.5a.75.75 0 0 1 0 1.5H13l-.7 8.05A1.75 1.75 0 0 1 10.56 14.2H5.44A1.75 1.75 0 0 1 3.7 12.55L3 4.5a.75.75 0 0 1-.25-1.5A.75.75 0 0 1 3.5 3H6v-.75A.75.75 0 0 1 6 1.5ZM5 4.5l.7 7.9a.25.25 0 0 0 .25.3h4.1a.25.25 0 0 0 .25-.25L11 4.5Zm1.5 1.5v6h1v-6Zm2.5 0v6h1v-6ZM6.5 3h3v-.5h-3Z"
          />
        </svg>
      </button>
    </div>
  );
}
