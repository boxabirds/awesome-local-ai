import type { JSX } from 'react';

export interface SelectionBarProps {
  /** The set of selected object ids. */
  ids: ReadonlySet<string>;
  /** Called when the user clicks "Delete selection". */
  onDelete(): void;
}

/**
 * The selection bar shown when 2 or more objects are selected.
 * Displays "N selected" and a "Delete selection" button.
 * When exactly one sticky is selected, the NoteToolbar is used instead.
 */
export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const count = props.ids.size;
  if (count < 2) return null;

  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection"
    >
      <span
        className="selection-count"
        data-testid="selection-count"
        aria-live="polite"
      >
        {count} selected
      </span>
      <button
        type="button"
        className="selection-delete-button"
        data-testid="selection-delete-button"
        aria-label="Delete selection"
        title="Delete selection"
        onClick={props.onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
          <path d="M2 3.5h10M5.5 3.5V2h3v1.5M3.5 3.5l.6 8.5h5.8l.6-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}
