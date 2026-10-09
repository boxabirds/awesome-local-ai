import { type JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  readonly ids: ReadonlySet<string>;
  readonly snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

/**
 * The bar that says how much is selected, and deletes it.
 *
 * It appears at two or more objects (PRD sel.bar). With exactly one sticky note selected
 * there is no bar: that note shows its own `NoteToolbar` instead, which is where colour
 * lives, and colour is a property of one note — a "make these three blue" button would
 * have to know three types, which is why the bar stays generic and the toolbar does not.
 *
 * The count is an accessible live region, so a screen reader says "3 selected" when a
 * marquee, Ctrl+A or somebody else's delete changed it (TC-17).
 */
export function SelectionBar({ ids, snapshot, onDelete }: SelectionBarProps): JSX.Element | null {
  const count = snapshot.filter((object) => ids.has(object.id)).length;
  if (count < 2) return null;
  return (
    <div className="vidi6-selection-bar" data-testid="selection-bar" role="toolbar" aria-label="Selection">
      <span className="vidi6-selection-count" data-testid="selection-count" aria-live="polite">
        {count} selected
      </span>
      <button type="button" className="vidi6-selection-delete" aria-label="Delete selection" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
