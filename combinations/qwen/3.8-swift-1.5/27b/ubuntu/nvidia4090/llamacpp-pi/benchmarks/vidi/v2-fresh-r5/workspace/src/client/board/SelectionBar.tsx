import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import { type StickyColor } from '../../shared/config';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete: () => void;
  onColor?: (color: StickyColor) => void;
}

/**
 * Selection bar shown above the selection bounding box.
 * - 2+ objects: "N selected" + Delete button
 * - Exactly 1 sticky: NoteToolbar (colours + delete)
 * - aria-live="polite" announces the count
 */
export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, onDelete, onColor } = props;

  if (ids.size === 0) return null;

  // Exactly one sticky note → show NoteToolbar
  if (ids.size === 1) {
    const [id] = ids;
    const obj = snapshot.find((o) => o.id === id);
    if (!obj || obj.type !== 'sticky') return null;
    const color = (obj.color ?? 'yellow') as StickyColor;
    return (
      <div data-testid="selection-bar" role="toolbar" aria-label="Note toolbar">
        <NoteToolbar
          color={color}
          onColor={onColor ?? (() => {})}
          onDelete={onDelete}
        />
      </div>
    );
  }

  // 2+ objects: "N selected" + Delete
  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection toolbar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        background: 'white',
        borderRadius: '6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: '13px',
      }}
    >
      <span aria-live="polite" data-testid="selection-count">
        {ids.size} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-btn"
        onClick={onDelete}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          border: '1px solid rgba(0,0,0,0.2)',
          background: 'white',
          cursor: 'pointer',
          fontSize: '14px',
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
