/**
 * The floating toolbar of the selected note: the six colour swatches and the
 * delete (bin) button.
 *
 * It lives inside the note but is counter-scaled by `1 / zoom` (see
 * `StickyNote`), so it stays a constant size on screen at every zoom level and
 * never ends up 800 px wide when the board is zoomed in. Every control has an
 * accessible name and the swatches say which colour they are, so colour is never
 * the only way to tell them apart.
 */

import type { JSX } from 'react';
import {
  NOTE_SWATCH_SIZE_PX,
  NOTE_TOOLBAR_SIDE_PADDING_PX,
  STICKY_COLORS,
  type StickyColor
} from '../../shared/config';

export interface NoteToolbarProps {
  /** The note's current colour, which is the pressed swatch. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

const COLOR_NAMES = Object.keys(STICKY_COLORS) as StickyColor[];

/** "yellow" -> "Yellow", for accessible names and tooltips. */
function colourLabel(name: StickyColor): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} colour`;
}

/**
 * Pointer and double-click events stop here: a click on the toolbar is not a
 * board gesture and must not clear the selection or create a note.
 */
const stopPointer = (event: { stopPropagation(): void }) => {
  event.stopPropagation();
};

export function NoteToolbar(props: NoteToolbarProps): JSX.Element {
  const { color, onColor, onDelete } = props;

  return (
    <div
      className="vidi6-note-toolbar"
      data-vidi6="note-toolbar"
      role="toolbar"
      aria-label="Sticky note options"
      onPointerDown={stopPointer}
      onDoubleClick={stopPointer}
      style={{ paddingLeft: NOTE_TOOLBAR_SIDE_PADDING_PX, paddingRight: NOTE_TOOLBAR_SIDE_PADDING_PX }}
    >
      {COLOR_NAMES.map((name) => (
        <button
          key={name}
          type="button"
          className="vidi6-note-swatch"
          data-vidi6="note-swatch"
          data-color={name}
          aria-label={colourLabel(name)}
          title={colourLabel(name)}
          aria-pressed={name === color}
          style={{ width: NOTE_SWATCH_SIZE_PX, height: NOTE_SWATCH_SIZE_PX, background: STICKY_COLORS[name] }}
          onClick={() => onColor(name)}
        />
      ))}
      <span className="vidi6-note-toolbar-separator" aria-hidden="true" />
      <button
        type="button"
        className="vidi6-note-delete"
        data-vidi6="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        {/* A bin, drawn inline so there is no icon dependency. */}
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4a1 1 0 0 1 1 1v1h3v1.5H2V4h3V3a1 1 0 0 1 1-1Zm1.5 1h1v.5h-1V3ZM3.5 7h9l-.6 6.2a1.5 1.5 0 0 1-1.5 1.3H5.6a1.5 1.5 0 0 1-1.5-1.3L3.5 7Z"
          />
        </svg>
      </button>
    </div>
  );
}
