import type { JSX } from 'react';

import type { StickyColor } from '../../shared/config';
import { isStickySnapshot } from '../../shared/board-model';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';

export interface SelectionBarProps {
  /** The selected ids, in no particular order. */
  readonly ids: ReadonlySet<string>;
  /** What the board can draw; only the selected objects are looked at. */
  readonly snapshot: readonly ObjectSnapshot[];
  /** Delete everything in the selection — one click, whatever its size. */
  onDelete(): void;
  /** False while this client may not write: controls stay, but cannot be used. */
  readonly editable: boolean;
  /**
   * The colour the toolbar's swatches show: the colour of the single selected
   * note, or `undefined` when the selection has no single colour to show.
   */
  readonly color?: StickyColor | undefined;
  /** Recolour every selected note; absent when there is nothing to recolour. */
  onColor?(color: StickyColor): void;
  /** True while a move or resize is in progress: the toolbar hides (TC-26). */
  readonly dragging?: boolean;
}

/** The selected note, when exactly one note of the selection is a note. */
function loneNote(
  ids: ReadonlySet<string>,
  snapshot: readonly ObjectSnapshot[],
): StickySnapshot | undefined {
  if (ids.size !== 1) return undefined;
  const lone = snapshot.find((object) => ids.has(object.id));
  return lone !== undefined && isStickySnapshot(lone) ? lone : undefined;
}

/**
 * The bar above a selection (`sel.bar`): how many are selected, and delete.
 *
 * For a *single* note it shows that note's toolbar instead — six colour swatches
 * and delete — because that is the same control in the same place, story 2 had it
 * there already, and two toolbars above one note would be farce. Both variants
 * hang in screen space above the selection's bounding box (the parent places
 * them), so they keep their size at every zoom and never become part of what
 * other people see.
 *
 * It owns no board state: it says what is selected and calls back.
 */
export function SelectionBar({
  ids,
  snapshot,
  onDelete,
  editable,
  color,
  onColor,
  dragging = false,
}: SelectionBarProps): JSX.Element | null {
  if (ids.size === 0) return null;
  const lone = loneNote(ids, snapshot);
  // One note on its own keeps the toolbar story 2 put above it, and the toolbar
  // hides during a drag: a control moving under the pointer is not a control
  // (TC-26). Anything else — two objects, one object that is not a note — gets
  // the bar.
  if (lone) {
    return !dragging && onColor ? (
      <NoteToolbar
        color={color ?? lone.color}
        disabled={!editable}
        onColor={(next) => onColor(next)}
        onDelete={onDelete}
      />
    ) : null;
  }
  return (
    <div className="selection-bar" data-testid="selection-bar" data-count={ids.size}>
      {/* Announced, because a person working by keyboard needs to know that the
          arrow keys are now moving something — and how many. */}
      <span className="selection-count" data-testid="selection-count" role="status" aria-live="polite">
        {ids.size} selected
      </span>
      <button
        type="button"
        className="toolbar-button danger"
        data-testid="selection-delete"
        aria-label="Delete selection"
        disabled={!editable}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
