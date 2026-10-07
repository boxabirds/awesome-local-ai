import { type ReactNode } from 'react';
import { deleteObjects } from '@/shared/board-model';
import type { ObjectSnapshot } from '@/client/objects/registry';
import { NoteToolbar } from '@/client/objects/NoteToolbar';
import type { StickyColor } from '@/shared/config';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

/**
 * Selection bar shown above the selection.
 * - When 2+ objects selected: "N selected" + Delete button with aria-label="Delete selection".
 * - When exactly 1 sticky note selected: NoteToolbar instead of bar (story 2 behaviour retained).
 * Uses aria-live="polite" to announce count changes to screen readers.
 */
export function SelectionBar({ ids, snapshot, onDelete }: SelectionBarProps): ReactNode {
  if (ids.size === 0) return null;

  // Single sticky → show NoteToolbar (handled by StickyNote component internally)
  if (ids.size === 1) {
    return null;
  }

  return (
    <div
      data-testid="selection-bar"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        top: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 16px',
        backgroundColor: '#2979ff',
        color: '#fff',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 500,
        boxShadow: '0 2px 8px rgba(41,121,255,0.3)',
        zIndex: 100,
        whiteSpace: 'nowrap',
      }}
    >
      <span data-testid="selection-count">
        {ids.size} selected
      </span>
      <button
        aria-label="Delete selection"
        data-testid="delete-selection-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete selection"
        style={{
          width: '24px',
          height: '24px',
          border: 'none',
          borderRadius: '4px',
          backgroundColor: 'rgba(255,255,255,0.2)',
          cursor: 'pointer',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          color: '#fff',
        }}
      >
        🗑
      </button>
    </div>
  );
}
