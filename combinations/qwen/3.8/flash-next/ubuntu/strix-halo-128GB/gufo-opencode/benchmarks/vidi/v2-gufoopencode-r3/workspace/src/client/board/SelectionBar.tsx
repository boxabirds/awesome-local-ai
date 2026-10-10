import type { StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

export interface SelectionBarProps {
  count: number;
  // Exactly one sticky note (and nothing else) selected: story 2 toolbar.
  singleSticky?: { color: StickyColor };
  onColor(color: StickyColor): void;
  onDelete(): void;
}

// Context bar for a multi-selection; a single sticky note keeps its story 2
// floating toolbar. The count is announced politely so screen readers hear
// selection changes (TC-17).
export function SelectionBar({ count, singleSticky, onColor, onDelete }: SelectionBarProps) {
  if (count === 0) return null;
  if (count === 1 && singleSticky !== undefined) {
    return (
      <NoteToolbar
        color={singleSticky.color}
        onColor={onColor}
        onDelete={onDelete}
      />
    );
  }
  return (
    <div className="selection-bar" data-testid="selection-bar" role="toolbar" aria-label="Selection">
      <span className="selection-count" aria-live="polite">
        {count} selected
      </span>
      <button
        type="button"
        className="selection-delete"
        aria-label="Delete selection"
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
