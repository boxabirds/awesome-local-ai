import type { JSX } from 'react';

import { STICKY_COLORS } from '../../shared/config';
import type { StickyColor } from '../../shared/config';

/**
 * Accessible names: colour swatches are distinguishable by name ("Pink
 * colour"), not only by colour (PRD accessibility constraint). The label is
 * both the accessible name and the tooltip.
 */
const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/** Screen-pixel height of the toolbar, used for the above-note anchor. */
export const NOTE_TOOLBAR_HEIGHT_PX = 32;
/** Gap between the toolbar and the top edge of the note (screen pixels). */
export const NOTE_TOOLBAR_GAP_PX = 8;

export interface NoteToolbarProps {
  /** Colour the note currently has; its swatch reads as pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * Floating toolbar of the selected note: six colour swatches and the delete
 * (bin) button. Hidden while Dragging or Editing (the parent decides). Clicks
 * never reach the viewport, which would clear the selection.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((name) => {
        const label = `${COLOR_LABELS[name]} colour`;
        return (
          <button
            key={name}
            type="button"
            className={`note-swatch note-swatch-${name}`}
            data-testid={`swatch-${name}`}
            aria-label={label}
            title={label}
            aria-pressed={color === name}
            style={{ background: STICKY_COLORS[name] }}
            onClick={() => {
              onColor(name);
            }}
          />
        );
      })}
      <button
        type="button"
        className="note-delete"
        data-testid="delete-note"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg
          aria-hidden="true"
          focusable="false"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            fill="currentColor"
            d="M6 2h4l.7.7V4H9v1h1.5v8.2c0 .5-.4.8-.8.8H6.3c-.5 0-.8-.3-.8-.8V5H7V4H5.3v-1.3L6 2Zm-.7 3v7h1.4V5H5.3Zm2.4 0v7h1.3V5H7.7Zm2.3 0v7h1.4V5h-1.4Z"
          />
        </svg>
      </button>
    </div>
  );
}
