import { type ReactNode } from 'react';
import { deleteObjects } from '@/shared/board-model';
import type { ObjectSnapshot } from '@/client/objects/registry';
import { NoteToolbar } from '@/client/objects/NoteToolbar';
import { TextToolbar } from '@/client/objects/TextToolbar';
import type { StickyColor, TextSize } from '@/shared/config';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  onSizeChange?(id: string, size: TextSize): void;
  onTextDelete?(): void; // called when deleting a single text
  onTextEndEdit?(): void; // called when ending edit of a single text
}

/**
 * Selection bar shown above the selection.
 * - When 2+ objects selected: "N selected" + Delete button with aria-label="Delete selection".
 * - When exactly 1 sticky note selected: NoteToolbar shown via StickyNote component.
 * - When exactly 1 text object selected: TextToolbar shown here.
 * Uses aria-live="polite" to announce count changes to screen readers.
 */
export function SelectionBar({ ids, snapshot, onDelete, onSizeChange, onTextDelete, onTextEndEdit }: SelectionBarProps): ReactNode {
  if (ids.size === 0) return null;

  // Single text object → show TextToolbar
  if (ids.size === 1) {
    const obj = snapshot.find((s) => s.id && s.type === 'text');
    if (obj) {
      const sizeKey = ((obj.size as string) ?? 'M') as TextSize;
      return (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            top: '16px',
            zIndex: 100,
          }}
        >
          <TextToolbar
            size={sizeKey}
            onSize={(s) => onSizeChange?.(obj.id, s)}
            onDelete={() => {
              onTextDelete?.();
              onDelete();
            }}
          />
        </div>
      );
    }
    // Single sticky → handled by StickyNote's own toolbar
    return null;
  }

  // Multiple → standard selection bar
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
