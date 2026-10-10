import type { ObjectSnapshot } from '../../shared/board-model';

/**
 * The bar that appears over a selection of two or more objects
 * (anchor `sel.interaction`).
 *
 * It is deliberately small: the count, and one action that only makes sense for
 * a group. One selected sticky note keeps story 2's `NoteToolbar`, which lives
 * on the note itself (TC-18).
 */
export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

export function SelectionBar(props: SelectionBarProps) {
  const { ids, snapshot, onDelete } = props;

  // An id that is no longer on the board is not counted: the selection is
  // pruned, but a render can still land between the two (TC-16, TC-35).
  const present = snapshot.filter((obj) => ids.has(obj.id));
  if (present.length < 2) {
    return null;
  }

  return (
    <div className="selection-bar" data-testid="selection-bar" role="toolbar" aria-label="Selection">
      <span
        className="selection-bar__count"
        data-testid="selection-count"
        role="status"
        aria-live="polite"
      >
        {present.length} selected
      </span>
      <button
        type="button"
        className="selection-bar__delete"
        data-testid="delete-selection"
        aria-label="Delete selection"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
