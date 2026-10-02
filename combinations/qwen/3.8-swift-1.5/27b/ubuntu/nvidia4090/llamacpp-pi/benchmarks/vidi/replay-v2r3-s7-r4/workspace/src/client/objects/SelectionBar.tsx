import { NoteToolbar } from './NoteToolbar';
import { type StickyColor } from '../../shared/config';
import type { ObjectSnapshot } from '../../shared/board-model';

export const SELECTION_BAR_TESTID = 'selection-bar';
export const SELECTION_COUNT_TESTID = 'selection-count';
export const SELECTION_DELETE_TESTID = 'selection-delete';
export const SELECTION_DELETE_LABEL = 'Delete selection';

export interface SelectionBarProps {
  objects: readonly ObjectSnapshot[];
  /** Called with the ids of the selected objects (all of them). */
  onDelete: (ids: string[]) => void;
  /** Color pick for the single-selection case (delegated to NoteToolbar). */
  onColor?: (id: string, color: string) => void;
}

/**
 * Story 7: the contextual bar for the current selection.
 *
 * - one object: the single-note toolbar (colour swatches + delete), unchanged
 *   from stories 2/3
 * - two or more objects: "{n} selected" + Delete
 */
export function SelectionBar({ objects, onDelete, onColor }: SelectionBarProps): React.ReactElement | null {
  if (objects.length === 1) {
    const obj = objects[0];
    return (
      <NoteToolbar
        color={(obj.color ?? 'yellow') as StickyColor}
        onColor={(c) => onColor?.(obj.id, c)}
        onDelete={() => onDelete([obj.id])}
      />
    );
  }

  if (objects.length < 2) return null;

  return (
    <div
      data-testid={SELECTION_BAR_TESTID}
      role="toolbar"
      aria-label="Selection"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #c8c8c8',
        borderRadius: 8,
        padding: '6px 10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
        fontSize: 13,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span data-testid={SELECTION_COUNT_TESTID} aria-live="polite">
        {objects.length} selected
      </span>
      <button
        type="button"
        aria-label={SELECTION_DELETE_LABEL}
        title={SELECTION_DELETE_LABEL}
        data-testid={SELECTION_DELETE_TESTID}
        onClick={() => onDelete(objects.map((o) => o.id))}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          fontSize: 13,
          padding: 0,
        }}
      >
        {SELECTION_DELETE_LABEL}
      </button>
    </div>
  );
}
