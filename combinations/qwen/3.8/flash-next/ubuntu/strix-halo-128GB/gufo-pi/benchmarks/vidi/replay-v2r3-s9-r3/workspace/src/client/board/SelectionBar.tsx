import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

/**
 * Shows "N selected" + Delete button when 2+ objects are selected.
 * Returns null for 0 or 1 selected (NoteToolbar handles single-sticky case).
 */
export function SelectionBar({ ids, onDelete }: SelectionBarProps) {
  const count = ids.size;
  if (count < 2) return null;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{
        position: 'fixed',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: '6px 12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        zIndex: 1000,
      }}
    >
      <span aria-live="polite" data-testid="selection-count">
        {count} selected
      </span>
      <button
        type="button"
        aria-label="Delete selection"
        data-testid="delete-selection-button"
        onClick={onDelete}
        style={{
          width: 28,
          height: 28,
          padding: 0,
          border: 'none',
          borderRadius: 6,
          background: 'none',
          color: '#5f6368',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M3 4h10M6.5 4V2.8h3V4M4.4 4l.6 9.2h6L11.6 4M6.6 6.2v5M9.4 6.2v5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
