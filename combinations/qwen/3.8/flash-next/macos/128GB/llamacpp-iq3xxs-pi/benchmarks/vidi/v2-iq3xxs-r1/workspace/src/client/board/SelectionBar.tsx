import { useRef } from 'react';
import { useNativeStopPropagation } from './useNativeStopPropagation';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** Props needed when exactly one sticky is selected to show NoteToolbar instead. */
  stickyColor?: string;
  stickyDisabled?: boolean;
  onStickyColor?(color: string): void;
  onStickyDelete?(): void;
}

/**
 * Shows "N selected" + Delete button when >= 2 objects are selected,
 * or delegates to NoteToolbar when exactly one sticky is selected.
 */
export function SelectionBar({
  ids,
  onDelete,
}: SelectionBarProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useNativeStopPropagation(ref);

  if (ids.size === 0) return null;

  // When exactly one sticky is selected, the StickyNote component renders NoteToolbar directly
  if (ids.size === 1) {
    return null;
  }

  return (
    <div
      ref={ref}
      className="selection-bar"
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
      style={{ pointerEvents: 'auto' }}
    >
      <span aria-live="polite" data-testid="selection-count">
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection"
        onClick={onDelete}
      >
        {'\u{1F5D1}'}
      </button>
    </div>
  );
}
