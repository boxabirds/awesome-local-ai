/**
 * SelectionBar: shows "N selected" + Delete button when 2+ objects are selected.
 * When exactly one sticky is selected, the NoteToolbar (shown on the note itself) handles it.
 * Includes an aria-live region for screen reader announcements.
 */

import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

/**
 * Returns null when fewer than 2 objects are selected (NoteToolbar handles single sticky).
 * When 2+ selected: shows "N selected" with a Delete button.
 */
export function SelectionBar({ ids, snapshot, onDelete }: SelectionBarProps) {
  // Count objects that actually exist in the snapshot
  const existingIds = new Set(snapshot.map((obj) => obj.id));
  let count = 0;
  for (const id of ids) {
    if (existingIds.has(id)) count++;
  }

  if (count < 2) return null;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        borderRadius: 6,
        padding: '4px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 10001,
        fontSize: 13,
        fontWeight: 500,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-live="polite" data-testid="selection-count">
        {count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="selection-bar-delete"
        onClick={onDelete}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          color: '#d32f2f',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 2h4l.6 1H13v1.5H3V3h2.4L6 2Zm-1 4h1.2l.3 6.2h-1.2L5 6Zm3.4 0h1.2v6.2H8.4V6Zm2.4 0H11l-.3 6.2h-1.2L10.8 6ZM4 13.5h8V15H4v-1.5Z"
          />
        </svg>
      </button>
    </div>
  );
}
