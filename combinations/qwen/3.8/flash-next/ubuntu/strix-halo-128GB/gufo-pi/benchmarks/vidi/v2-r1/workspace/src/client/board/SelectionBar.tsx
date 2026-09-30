import type { JSX } from 'react';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: ReadonlyArray<{ id: string; type: string; color?: string }>;
  onDelete(): void;
  onColor?(id: string, color: string): void;
  editingId?: string | null;
  isDragging?: boolean;
}

/**
 * Selection bar: shows "N selected" + Delete when 2+ objects are selected.
 * The NoteToolbar for a single sticky is rendered by StickyNote itself.
 * Returns null when 0 or 1 objects are selected.
 */
export function SelectionBar({ ids, onDelete }: SelectionBarProps): JSX.Element | null {
  const count = ids.size;

  if (count < 2) return null;

  const announcement = `${count} selected`;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
    >
      <span data-testid="selection-count">{count} selected</span>
      <button
        type="button"
        data-testid="delete-selection"
        aria-label="Delete selection"
        className="selection-bar__delete"
        onClick={onDelete}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3h2.5a.75.75 0 0 1 0 1.5H13l-.7 8.05A1.75 1.75 0 0 1 10.56 14.2H5.44A1.75 1.75 0 0 1 3.7 12.55L3 4.5a.75.75 0 0 1-.25-1.5A.75.75 0 0 1 3.5 3H6v-.75A.75.75 0 0 1 6 1.5ZM5 4.5l.7 7.9a.25.25 0 0 0 .25.3h4.1a.25.25 0 0 0 .25-.25L11 4.5Zm1.5 1.5v6h1v-6Zm2.5 0v6h1v-6ZM6.5 3h3v-.5h-3Z"
          />
        </svg>
      </button>
      {/* Screen reader announcement */}
      <span aria-live="polite" className="sr-only" data-testid="selection-announcement">
        {announcement}
      </span>
    </div>
  );
}
