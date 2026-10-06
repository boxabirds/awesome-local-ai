/**
 * The one bar for a selection of more than one thing.
 *
 * A single sticky note has its own toolbar, on the note, because the tools that belong to one note
 * belong next to it. Two notes do not have two toolbars: they have one selection, and what a selection
 * of any size can be asked to do is very nearly one thing — go away — so this bar says how many things
 * are in it and offers the delete that acts on all of them at once. One transaction, one undo step
 * when story 8 comes, one answer on every other screen.
 *
 * The count is a live region, so a person who cannot see the board hears "4 selected" when a colleague
 * deletes one of the four and the selection quietly gets smaller.
 */

import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  /** What is selected. */
  ids: ReadonlySet<string>;
  /** The board, so the count can be said of objects that are actually there. */
  snapshot: readonly ObjectSnapshot[];
  /** Delete the whole selection. The board does it; this only asks. */
  onDelete(): void;
}

/** What a selection of exactly one is called in this file: nothing, because the object says it itself. */
const MIN_GROUP = 2;

export function SelectionBar({ ids, snapshot, onDelete }: SelectionBarProps): React.JSX.Element | null {
  // The count of selected objects that are still on the board — which is what the selection means,
  // and not what it was a moment ago before somebody else's delete arrived.
  const selected = snapshot.filter((object) => ids.has(object.id));
  if (selected.length < MIN_GROUP) return null;

  return (
    <div className="selection-bar" data-testid="selection-bar" data-count={selected.length}>
      <span aria-live="polite" className="selection-count" data-testid="selection-count" role="status">
        {`${selected.length} selected`}
      </span>
      <button
        aria-label="Delete selection"
        className="selection-delete"
        data-testid="delete-selection"
        title="Delete selection"
        type="button"
        onPointerDown={(event) => {
          // The bar is a control, not part of the board: a press on it never starts a gesture.
          event.stopPropagation();
        }}
        onClick={onDelete}
      >
        <span aria-hidden="true">🗑</span>
      </button>
    </div>
  );
}
