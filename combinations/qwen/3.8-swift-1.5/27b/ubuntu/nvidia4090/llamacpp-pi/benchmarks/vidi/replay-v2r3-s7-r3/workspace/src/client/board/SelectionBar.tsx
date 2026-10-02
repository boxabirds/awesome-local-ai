import type { ObjectSnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

export interface SelectionBarProps {
  /** The selected object ids. */
  ids: ReadonlySet<string>;
  /** All board objects (to resolve the selection). */
  snapshot: readonly ObjectSnapshot[];
  /** Delete the selected objects (story 7). */
  onDelete: () => void;
  /** Recolour the selected sticky notes (story 2, kept for the single-note bar). */
  onColor?: (color: StickyColor) => void;
}

/**
 * The floating bar above the selection (story 7, sel.delete):
 * - 2+ objects: "N selected" (aria-live) + a "Delete selection" button.
 * - exactly 1 sticky note: the existing NoteToolbar (recolor + delete note).
 * - 1 non-sticky object: nothing (no type-specific toolbar is required).
 */
export function SelectionBar({ ids, snapshot, onDelete, onColor }: SelectionBarProps): React.ReactElement | null {
  if (ids.size === 0) return null;
  const selected = snapshot.filter((o) => ids.has(o.id));

  if (selected.length === 1 && selected[0].type === 'sticky') {
    return (
      <NoteToolbar
        color={selected[0].color ?? 'yellow'}
        onColor={onColor ?? (() => undefined)}
        onDelete={onDelete}
      />
    );
  }

  return (
    <div
      data-testid="selection-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: '#fff',
        border: '1px solid #90CAF9',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        padding: '4px 8px',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-live="polite" data-testid="selection-count" style={{ fontSize: 12, color: '#333' }}>
        {selected.length} selected
      </span>
      <button
        aria-label="Delete selection"
        onClick={onDelete}
        style={{
          border: '1px solid #EF9A9A',
          background: '#FFEBEE',
          color: '#B71C1C',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        Delete
      </button>
    </div>
  );
}
