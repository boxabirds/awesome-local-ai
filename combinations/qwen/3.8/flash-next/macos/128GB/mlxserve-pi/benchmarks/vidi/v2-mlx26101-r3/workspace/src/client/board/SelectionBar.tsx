import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  /** What this user has selected. */
  ids: ReadonlySet<string>;
  /** The board's objects: an id that is no longer among them is not counted. */
  snapshot: readonly ObjectSnapshot[];
  /** Delete every selected object in one go. */
  onDelete(): void;
  /** Whether the board may be written to; a board that could not be loaded only reads. */
  canEdit?: boolean;
}

/**
 * The bar that appears while a *selection* of objects is held: how many there are, and one
 * button that deletes them all.
 *
 * It shows for two or more, and not for one. A single sticky note already carries its own
 * toolbar - the six colours and the delete that story 2 gave it - and two toolbars for one note
 * would be two answers to one question. The moment there is more than one object there is no
 * single object's toolbar that could speak for the group, which is exactly when a bar with a
 * count in it earns its place.
 *
 * The count is counted from the objects the board actually holds, not out of the selection's own
 * arithmetic: when a colleague deletes two of your nine selected notes, the bar says seven
 * because seven objects are there to be counted, not because anything was subtracted.
 *
 * That count is in an `aria-live` region, because "which three did I just get?" is a question
 * asked with the eyes on the board and not on the bar; the announcement is what makes the number
 * reach a person who is not looking for it.
 */
export function SelectionBar({
  ids,
  snapshot,
  onDelete,
  canEdit = true,
}: SelectionBarProps): JSX.Element | null {
  const present = new Set(snapshot.map((object) => object.id));
  let count = 0;
  for (const id of ids) {
    if (present.has(id)) {
      count += 1;
    }
  }
  if (count < 2) {
    return null;
  }
  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      data-board-ui=""
      role="toolbar"
      aria-label="Selection"
      onPointerDown={(event) => {
        // The bar is a control, not part of the board: pressing it never pans or marquee-drags.
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        // Nor does a double press on it plant a note behind the bar.
        event.stopPropagation();
      }}
    >
      <span className="selection-bar__count" data-testid="selection-count" aria-live="polite">
        {`${count} selected`}
      </span>
      <button
        type="button"
        className="selection-bar__delete"
        data-testid="selection-delete"
        aria-label="Delete selection"
        title="Delete selection"
        disabled={!canEdit}
        onClick={onDelete}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            fill="currentColor"
            d="M7 21a2 2 0 0 1-2-2V6H4V4h5V2h6v2h5v2h-1v13a2 2 0 0 1-2 2H7Zm10-15H7v12h10V6ZM9 8h2v9H9V8Zm4 0h2v9h-2V8Z"
          />
        </svg>
      </button>
    </div>
  );
}
