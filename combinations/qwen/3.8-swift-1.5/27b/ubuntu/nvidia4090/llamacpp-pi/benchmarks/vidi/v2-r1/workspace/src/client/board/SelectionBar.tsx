import type { StickySnapshot, ObjectSnapshot } from '@shared/board-model';
import type { StickyColor } from '@shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete: () => void;
  onColor?: (color: StickyColor) => void;
}

/**
 * Story 7 selection bar (PRD sel.bar):
 * - two or more objects selected → "N selected" + Delete button;
 * - exactly one sticky note selected → story 2's NoteToolbar (colours +
 *   delete) appears instead.
 * The count is announced to screen readers via an aria-live region.
 * Hidden when nothing is selected.
 */
export function SelectionBar({ ids, snapshot, onDelete, onColor }: SelectionBarProps) {
  const count = ids.size;
  if (count === 0) return null;

  if (count === 1) {
    const [id] = ids;
    const obj = snapshot.find((o) => o.id === id);
    if (obj && obj.type === 'sticky') {
      const sticky = obj as StickySnapshot;
      return (
        <NoteToolbar
          color={sticky.color}
          onColor={(c) => onColor?.(c)}
          onDelete={onDelete}
        />
      );
    }
    return null;
  }

  return (
    <div
      data-testid="selection-bar"
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        data-testid="selection-count"
        aria-live="polite"
        style={{ fontSize: 12, color: '#333' }}
      >
        {count} selected
      </span>
      <button
        aria-label="Delete selection"
        data-testid="delete-selection"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          border: 'none',
          background: 'transparent',
          fontSize: 16,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
        }}
      >
        🗑
      </button>
    </div>
  );
}
