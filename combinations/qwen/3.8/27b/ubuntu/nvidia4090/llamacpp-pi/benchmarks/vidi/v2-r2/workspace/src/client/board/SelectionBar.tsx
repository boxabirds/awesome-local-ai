/**
 * Multi-selection bar (story 7, sel.interaction).
 *
 * Visible only with two or more selected objects: a bar with "N selected"
 * (announced through an aria-live="polite" region) and a Delete button
 * (`aria-label="Delete selection"`) that deletes the whole selection.
 *
 * Exactly one selected sticky shows story 2's NoteToolbar instead (rendered
 * by the board); one selected non-sticky object shows nothing (keyboard
 * delete still works).
 */
import type { JSX } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

interface Props {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
  /** load_failed: delete is disabled. */
  disabled?: boolean;
}

export function SelectionBar({ ids, snapshot, onDelete, disabled = false }: Props): JSX.Element | null {
  if (ids.size < 2) {
    return null;
  }
  const present = snapshot.filter((o) => ids.has(o.id)).length;
  if (present === 0) {
    return null;
  }

  return (
    <div
      data-testid="selection-bar"
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: '50%',
        top: 12,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 12px',
        background: 'rgba(255,255,255,0.96)',
        border: '1px solid #d8d8d0',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.16)',
        zIndex: 2500,
      }}
    >
      <span>{`${ids.size} selected`}</span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="selection-delete-button"
        onClick={onDelete}
        disabled={disabled}
        style={{
          padding: '4px 10px',
          background: '#f4f4f0',
          border: '1px solid #d8d8d0',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        Delete
      </button>
    </div>
  );
}
