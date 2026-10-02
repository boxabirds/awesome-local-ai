import React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { getObjectType } from '../objects/registry';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  onDelete(): void;
}

/**
 * Selection bar: shows "N selected" + Delete button when 2+ objects are selected.
 * For exactly one sticky note, the NoteToolbar (rendered by StickyNote) appears instead.
 * This component returns null in that case.
 */
export function SelectionBar({ ids, snapshot, onDelete }: SelectionBarProps) {
  if (ids.size < 2) return null;

  const count = ids.size;

  return (
    <div
      data-testid="selection-bar"
      role="toolbar"
      aria-label="Selection tools"
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: '4px 8px',
        boxShadow: '0 1px 6px rgba(0,0,0,0.2)',
        zIndex: 1000,
      }}
      onPointerDown={(e) => e.stopPropagation()}
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
          width: 24,
          height: 24,
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
