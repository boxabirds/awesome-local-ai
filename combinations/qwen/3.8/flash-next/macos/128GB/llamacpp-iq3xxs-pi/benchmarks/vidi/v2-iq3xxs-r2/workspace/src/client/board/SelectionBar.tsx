import { type JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import type { TextSize } from '../../shared/objects/text';
import { TextToolbar } from '../objects/TextToolbar';

export interface SelectionBarProps {
  readonly ids: ReadonlySet<string>;
  readonly snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /**
   * Story 9: what to do with the selected object when it is the one text object on the
   * screen. Absent for every other selection, including one sticky note — that note shows
   * its own `NoteToolbar` instead.
   */
  text?: { size: TextSize; onSize(size: TextSize): void } | null;
}

/**
 * The bar that says how much is selected, and deletes it.
 *
 * It appears at two or more objects (PRD sel.bar), and at exactly one text object, where it
 * is the text toolbar instead: sizes, and the same delete (PRD: the toolbar above a heading
 * is where its size is picked). With exactly one sticky note selected there is no bar: that
 * note shows its own `NoteToolbar` in its own place, and colour is a property of one note —
 * a "make these three blue" button would have to know three types, which is why the bar
 * stays generic and the toolbars do not.
 *
 * The count is an accessible live region, so a screen reader says "3 selected" when a
 * marquee, Ctrl+A or somebody else's delete changed it (TC-17).
 */
export function SelectionBar({ ids, snapshot, onDelete, text = null }: SelectionBarProps): JSX.Element | null {
  const count = snapshot.filter((object) => ids.has(object.id)).length;
  if (count === 0) return null;
  if (count === 1 && text === null) return null;
  return (
    <div className="vidi6-selection-bar" data-testid="selection-bar" role="toolbar" aria-label="Selection">
      {count === 1 && text ? (
        <TextToolbar size={text.size} onSize={text.onSize} onDelete={onDelete} />
      ) : (
        <>
          <span className="vidi6-selection-count" data-testid="selection-count" aria-live="polite">
            {count} selected
          </span>
          <button type="button" className="vidi6-selection-delete" aria-label="Delete selection" onClick={onDelete}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}
