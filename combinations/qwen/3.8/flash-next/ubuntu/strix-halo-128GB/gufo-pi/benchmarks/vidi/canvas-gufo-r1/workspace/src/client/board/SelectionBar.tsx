import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

/**
 * Shows "N selected" + Delete button when 2+ objects are selected.
 * When exactly one sticky note is selected, shows NoteToolbar instead.
 * Returns null for 0 selected.
 */
export function SelectionBar(props: SelectionBarProps) {
  const { ids, onDelete } = props;

  if (ids.size === 0) return null;

  // Exactly one sticky: show NoteToolbar instead (handled by BoardApp)
  if (ids.size === 1) {
    return null; // NoteToolbar is rendered separately by BoardApp
  }

  // 2+ selected: show the "N selected" bar
  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
    >
      <span
        aria-live="polite"
        data-testid="selection-count"
        className="selection-count"
      >
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-btn"
        className="selection-bar-delete"
        onClick={onDelete}
        onPointerDown={(e) => e.stopPropagation()}
        title="Delete selected objects"
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
