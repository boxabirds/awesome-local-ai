/**
 * The one bar for a selection of more than one thing — and for the one thing that has tools of its own.
 *
 * A single sticky note has its own toolbar, on the note, because the tools that belong to one note
 * belong next to it. Two notes do not have two toolbars: they have one selection, and what a selection
 * of any size can be asked to do is very nearly one thing — go away — so this bar says how many things
 * are in it and offers the delete that acts on all of them at once. One transaction, one undo step
 * when story 8 comes, one answer on every other screen.
 *
 * A single text object is the exception story 9 added, and it is an exception of degree rather than of
 * kind: a text object's tools are the four sizes it can be, and those are tools for the selection in
 * the same way the delete is — they act on what is selected, from the same place, and a text object
 * carrying its own palette would be a note's toolbar with the note's colours on it. So the bar takes
 * one thing sometimes, and what it says then is not "1 selected" but the sizes.
 *
 * The count is a live region, so a person who cannot see the board hears "4 selected" when a colleague
 * deletes one of the four and the selection quietly gets smaller.
 */

import { isTextSnapshot, type ObjectSnapshot } from '../../shared/board-model';
import type { TextSize } from '../../shared/objects/text';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  /** What is selected. */
  ids: ReadonlySet<string>;
  /** The board, so the count can be said of objects that are actually there. */
  snapshot: readonly ObjectSnapshot[];
  /** Delete the whole selection. The board does it; this only asks. */
  onDelete(): void;
  /**
   * Makes the one selected text object this size. Given together with a selection that can be asked —
   * one text object, and nothing else — because the size of a thing is the board's to write, not the
   * button's.
   */
  onTextSize?(size: TextSize): void;
}

/** What a selection of exactly one is called in this file: nothing, because the object says it itself. */
const MIN_GROUP = 2;

export function SelectionBar({
  ids,
  snapshot,
  onDelete,
  onTextSize,
}: SelectionBarProps): React.JSX.Element | null {
  // The count of selected objects that are still on the board — which is what the selection means,
  // and not what it was a moment ago before somebody else's delete arrived.
  const selected = snapshot.filter((object) => ids.has(object.id));

  // One text object, alone in the selection, gets the tools every piece of text in this product wants:
  // how big is it. Anything else in the selection — a note, a second text object, a type this build
  // cannot even draw — and the bar goes back to counting.
  const only = selected.length === 1 ? selected[0] : undefined;
  if (only !== undefined && onTextSize !== undefined && isTextSnapshot(only)) {
    return (
      <div
        className="selection-bar selection-bar-single"
        data-testid="selection-bar"
        data-count={1}
        data-object-type={only.type}
      >
        <TextToolbar onDelete={onDelete} onSize={onTextSize} size={only.size} />
      </div>
    );
  }

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
