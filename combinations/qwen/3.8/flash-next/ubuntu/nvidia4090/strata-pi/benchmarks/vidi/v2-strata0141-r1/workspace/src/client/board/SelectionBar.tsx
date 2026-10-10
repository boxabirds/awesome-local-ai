import type { ObjectSnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { TextToolbar } from '../objects/TextToolbar';

/**
 * The bar that appears over a selection of two or more objects
 * (anchor `sel.interaction`).
 *
 * It is deliberately small: the count, and one action that only makes sense for
 * a group. One selected sticky note keeps story 2's `NoteToolbar`, which lives
 * on the note itself (TC-18). One selected **text** object gets the `TextToolbar`
 * from here instead (`text.object`): a text has no colour to pick, so its tools
 * are its size and deleting it.
 */
export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** The size buttons of a single selected text object (`text.object`). */
  onTextSize?(id: string, size: TextSize): void;
}

export function SelectionBar(props: SelectionBarProps) {
  const { ids, snapshot, onDelete, onTextSize } = props;

  // An id that is no longer on the board is not counted: the selection is
  // pruned, but a render can still land between the two (TC-16, TC-35).
  const present = snapshot.filter((obj) => ids.has(obj.id));

  const one = present.length === 1 ? present[0]! : null;
  if (one && one.type === 'text' && onTextSize) {
    return (
      <div className="selection-bar" data-testid="text-selection-bar">
        <TextToolbar
          size={(one as TextSnapshot).size}
          onSize={(size) => {
            onTextSize(one.id, size);
          }}
          onDelete={onDelete}
        />
      </div>
    );
  }

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
