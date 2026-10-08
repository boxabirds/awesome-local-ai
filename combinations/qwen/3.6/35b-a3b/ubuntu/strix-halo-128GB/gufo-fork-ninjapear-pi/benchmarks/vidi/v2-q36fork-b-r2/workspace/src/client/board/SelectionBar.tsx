import * as React from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import { STICKY_SIZE_WORLD } from '../../shared/config';
import { deleteObjects, allObjectIds } from '../../shared/board-model';
import type { Doc } from 'yjs';

interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  doc?: Doc;
  onDelete(): void;
}

export function SelectionBar(props: SelectionBarProps): React.JSX.Element | null {
  const { ids, snapshot, doc, onDelete } = props;
  
  if (ids.size === 0) return null;

  // Single sticky note → show NoteToolbar instead of bar
  if (ids.size === 1) {
    const id = [...ids][0];
    const note = snapshot.find((s) => s.id === id);
    if (!note || note.type !== 'sticky') return null;
    // Don't render toolbar here — it's rendered in BoardApp for single selection
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#323232',
        color: '#fff',
        padding: '8px 16px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: 100,
        userSelect: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      {/* Live region for screen reader announcements */}
      <span
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {ids.size} selected
      </span>
      <span>{ids.size} selected</span>
      <button
        aria-label="Delete selection"
        onClick={onDelete}
        style={{
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '16px',
          padding: '2px 6px',
          borderRadius: '4px',
        }}
        title="Delete selection"
      >
        🗑️
      </button>
    </div>
  );
}
