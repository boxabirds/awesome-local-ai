import type { JSX } from 'react';

import { STICKY_COLORS } from '../../shared/config';
import { BinIcon } from './icons';
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
  /** The whole toolbar is inert while the board cannot be written to. */
  disabled?: boolean;
}

/**
 * Floating toolbar of the selected note: six colour swatches and the delete
 * (bin) button. Hidden while Dragging or Editing (the parent decides). Clicks
 * never reach the viewport, which would clear the selection.
 */
export function NoteToolbar({
  color,
  onColor,
  onDelete,
  disabled = false,
}: NoteToolbarProps): JSX.Element {
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
            disabled={disabled}
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
        disabled={disabled}
        onClick={onDelete}
      >
        <BinIcon />
      </button>
    </div>
  );
}
