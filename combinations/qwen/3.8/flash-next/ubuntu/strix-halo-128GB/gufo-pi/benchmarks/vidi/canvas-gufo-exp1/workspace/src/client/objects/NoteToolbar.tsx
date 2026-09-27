/**
 * Floating toolbar for the selected sticky note: six colour swatches and a
 * delete (bin) button. Rendered in screen space (it does not scale with zoom)
 * above the note, and never while dragging or editing.
 */
import type { JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(color: StickyColor): void;
  onDelete(): void;
}

/** Capitalised accessible name for a colour key, e.g. "yellow" -> "Yellow". */
const colourName = (key: StickyColor): string => key.charAt(0).toUpperCase() + key.slice(1);

export function NoteToolbar({ color, onColor, onDelete }: NoteToolbarProps): JSX.Element {
  return (
    <div
      className="note-toolbar"
      data-testid="note-toolbar"
      role="toolbar"
      aria-label="Note toolbar"
      // Clicks on the toolbar must never reach the viewport (that would clear
      // the selection this toolbar belongs to).
      onPointerDown={(event) => event.stopPropagation()}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((key) => (
        <button
          key={key}
          type="button"
          className="note-swatch"
          data-testid={`swatch-${key}`}
          data-color={key}
          style={{ backgroundColor: STICKY_COLORS[key] }}
          aria-label={`${colourName(key)} colour`}
          title={`${colourName(key)} colour`}
          aria-pressed={key === color}
          onClick={() => onColor(key)}
        />
      ))}
      <button
        type="button"
        className="note-delete"
        data-testid="note-delete"
        aria-label="Delete note"
        title="Delete note"
        onClick={() => onDelete()}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path
            d="M3 4h8M5.5 4V2.5h3V4M4.5 4l.5 8h4l.5-8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
