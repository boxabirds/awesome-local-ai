import { type JSX } from 'react';
import { STICKY_COLORS, type StickyColor } from '../../shared/config';

const COLOR_NAMES: Record<StickyColor, string> = {
  yellow: 'Yellow',
  orange: 'Orange',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
  violet: 'Violet',
};

export interface NoteToolbarProps {
  color: StickyColor;
  onColor(c: StickyColor): void;
  onDelete(): void;
  /**
   * When true (persist.client_status load_failed) the swatches and delete
   * are disabled, so a load-failed board can never be recoloured or delete a
   * note. The board also guards its handlers; this makes the intent visible
   * in the DOM (disabled buttons) for the component tests.
   */
  disabled?: boolean;
}

/**
 * Floating per-note toolbar: the six colour swatches and a bin button.
 *
 * Rendered in screen space, centred just above the selected note. It is
 * hidden while the note is being edited or dragged (the board decides that);
 * it stops pointer/double-click propagation so pressing it never deselects
 * the note, pans the board, or creates a note.
 */
export function NoteToolbar({ color, onColor, onDelete, disabled = false }: NoteToolbarProps): JSX.Element {
  return (
    <div
      data-testid="note-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #d8d8d0',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
      }}
    >
      {(Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${COLOR_NAMES[c]} colour`}
          title={disabled ? 'Board unavailable' : `${COLOR_NAMES[c]} colour`}
          aria-pressed={color === c}
          disabled={disabled}
          data-testid={`note-swatch-${c}`}
          onClick={() => onColor(c)}
          style={{
            width: 20,
            height: 20,
            padding: 0,
            background: STICKY_COLORS[c],
            border: color === c ? '2px solid #1a73e8' : '1px solid rgba(0,0,0,0.22)',
            borderRadius: 4,
            cursor: 'pointer',
            boxSizing: 'border-box',
          }}
        />
      ))}
      <button
        type="button"
        aria-label="Delete note"
        title={disabled ? 'Board unavailable' : 'Delete note'}
        disabled={disabled}
        data-testid="note-delete-button"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </div>
  );
}
