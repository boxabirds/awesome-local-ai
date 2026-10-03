import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

/** Colour names as they appear in the swatches' accessible names (PRD: six presets). */
const COLOR_LABELS: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

const ORDER = Object.keys(STICKY_COLORS) as StickyColor[];

export interface NoteToolbarProps {
  /** The note's current colour, shown as pressed. */
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/**
 * The small toolbar above a selected note: six colours and a delete button.
 *
 * The colour buttons are `aria-pressed` radio-like toggles: the active one is the note's
 * current colour. Nothing here drags or zooms the board - `data-board-ui` plus stopping
 * propagation keeps the press inside the toolbar (the board ignores presses on UI, and
 * the note itself never sees the event).
 */
export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  const stop = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };
  return (
    <div
      className="note-toolbar"
      data-board-ui=""
      data-testid="note-toolbar"
      role="group"
      aria-label="Note toolbar"
      onPointerDown={stop}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
    >
      {ORDER.map((name) => (
        <button
          key={name}
          type="button"
          className={`note-toolbar__swatch note-toolbar__swatch--${name}`}
          data-testid="note-color"
          data-color-name={name}
          style={{ background: STICKY_COLORS[name] }}
          aria-label={`${COLOR_LABELS[name]} colour`}
          title={`${COLOR_LABELS[name]} colour`}
          aria-pressed={name === color}
          onClick={() => {
            onColor(name);
          }}
        />
      ))}
      <button
        type="button"
        className="note-toolbar__delete"
        data-testid="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M7 21a2 2 0 0 1-2-2V6H4V4h5V2h6v2h5v2h-1v13a2 2 0 0 1-2 2H7Zm10-15H7v12h10V6ZM9 8h2v9H9V8Zm4 0h2v9h-2V8Z"
          />
        </svg>
      </button>
    </div>
  );
}
