import type { CSSProperties, SyntheticEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Toolbar box, in screen pixels: the layout it keeps at every zoom level. */
export const NOTE_TOOLBAR_W_PX = 208;
export const NOTE_TOOLBAR_H_PX = 32;
/** Screen gap between the top of a note and its toolbar. */
export const NOTE_TOOLBAR_GAP_PX = 8;

/** Colour name as it appears in each swatch's accessible name and tooltip. */
const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

/** Order of the swatches: the order the colours are declared in config. */
const COLOR_ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * Floating toolbar for the selected note: six colour swatches and a delete
 * button. Rendered in screen space above the note, so it does not scale with
 * zoom, and hidden while dragging or editing.
 *
 * Swatches are distinguishable by name, not only by colour: each has an
 * accessible name ("<Colour> colour") plus a tooltip, and carries
 * `aria-pressed` for the current colour.
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps) {
  const stop = (e: SyntheticEvent) => {
    // A click on the toolbar is not a click on the board: it must not clear
    // the selection or start a pan.
    e.stopPropagation();
  };

  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="group"
      aria-label="Note tools"
      onPointerDown={stop}
      onDoubleClick={stop}
    >
      {COLOR_ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className="note-swatch"
          data-testid={`swatch-${name}`}
          data-color={name}
          aria-label={`${COLOR_LABELS[name]} colour`}
          title={COLOR_LABELS[name]}
          aria-pressed={name === color}
          style={{ '--swatch': STICKY_COLORS[name] } as CSSProperties}
          onClick={() => onColor(name)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}
