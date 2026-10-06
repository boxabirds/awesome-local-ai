import type { JSX } from 'react';

/**
 * The bar that floats over a multi-object selection
 * (`src/client/objects/SelectionBar.tsx`).
 *
 * A single selected sticky shows *its own* toolbar (the note already owns the
 * colour/delete/edit controls, and there is one of it). Two or more selected
 * objects show this bar instead: the count of the selection - announced to a
 * screen reader, because "did my marquee actually grab those?" is invisible to a
 * non-visual user - and one Delete action that works on the whole selection.
 *
 * It is deliberately minimal. Group actions that arrive with later stories
 * (colour across a selection, alignment, grouping, z-order) extend this bar;
 * story 7 ships only what its own acceptance needs.
 */

export interface SelectionBarProps {
  /** How many objects are selected. */
  count: number;
  /** Delete every selected object (kept as one user action). */
  onDelete(): void;
}

export default function SelectionBar({ count, onDelete }: SelectionBarProps): JSX.Element | null {
  // A lone object uses its own toolbar, not this bar; nothing selected shows it
  // not at all.
  if (count < 2) return null;

  return (
    <div className="selection-bar" role="toolbar" aria-label="Selection" data-testid="selection-bar">
      <span className="selection-count" role="status" aria-live="polite" data-testid="selection-count">
        {`${count} selected`}
      </span>
      <button
        type="button"
        className="selection-delete"
        data-testid="selection-delete"
        aria-label="Delete selection"
        title="Delete selection (Delete)"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}
