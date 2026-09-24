/**
 * Story 7 · task 10 — the selection bar (design "Selection state and selection
 * bar").
 *
 * Shown when **two or more** objects are selected: an `aria-live="polite"`
 * region that announces the count and a single *Delete selection* action that
 * removes the whole group in one step. With exactly one object selected the
 * story 2 per-note `NoteToolbar` is shown instead (rendered by the note), so
 * the bar is `null` for a selection of size 0 or 1.
 *
 * The delete handler is passed in (not read from a store) so the bar stays a
 * presentational piece testable in isolation.
 */
import type { JSX } from 'react';

export interface SelectionBarProps {
  /** Number of selected objects; the bar renders only when this is >= 2. */
  count: number;
  onDelete(): void;
}

export function SelectionBar({ count, onDelete }: SelectionBarProps): JSX.Element | null {
  if (count < 2) return null;
  return (
    <div
      className="selection-bar"
      data-testid="selection-bar"
      data-count={count}
      role="toolbar"
      aria-label="Selection actions"
    >
      <span className="selection-count" data-testid="selection-count" aria-live="polite">
        {`${count} selected`}
      </span>
      <button
        type="button"
        className="selection-delete"
        data-testid="selection-delete"
        aria-label="Delete selection"
        // A pointer-down here must not reach the board surface and clear the
        // selection this bar depends on.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
