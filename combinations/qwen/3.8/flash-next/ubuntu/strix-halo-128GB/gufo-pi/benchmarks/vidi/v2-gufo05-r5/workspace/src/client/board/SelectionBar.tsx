/**
 * Selection bar: shows "N selected" with a Delete button when 2+ objects are selected.
 * When exactly one sticky note is selected, the NoteToolbar (rendered by StickyNote) handles it.
 */
import type { JSX } from 'react';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  onDelete(): void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const count = props.ids.size;
  if (count < 2) return null;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
    >
      <span
        aria-live="polite"
        data-testid="selection-count"
      >
        {count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="selection-delete"
        onClick={props.onDelete}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M6 1.5h4a.75.75 0 0 1 .75.75V3H13a.75.75 0 0 1 0 1.5h-.35l-.55 8.1A1.75 1.75 0 0 1 10.36 14.3H5.64a1.75 1.75 0 0 1-1.74-1.7L3.35 4.5H3A.75.75 0 0 1 3 3h2.25v-.75A.75.75 0 0 1 6 1.5Zm1.5 1.5v-.5h1v.5h-1ZM5 4.5l.5 7.6h5L11 4.5H5Z"
          />
        </svg>
      </button>
    </div>
  );
}
