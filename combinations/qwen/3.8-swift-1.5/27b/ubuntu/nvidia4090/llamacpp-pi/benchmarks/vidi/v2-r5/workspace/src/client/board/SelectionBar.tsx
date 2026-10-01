// src/client/board/SelectionBar.tsx
// Shows "N selected" + Delete for multi-selection, or NoteToolbar for single sticky.

import type { ReactElement } from 'react';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import { setStickyColor, deleteObject } from '../../shared/board-model';
import * as Y from 'yjs';
import type { StickyColor } from '../../shared/config';
import type { UndoController } from '../board/undo';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onDelete: () => void;
  /** Per-client undo controller (story 8): colour/delete are single steps. */
  undo?: UndoController;
}

export function SelectionBar(props: SelectionBarProps): ReactElement | null {
  const { ids, snapshot, doc, onDelete, undo } = props;
  const count = ids.size;

  if (count === 0) return null;

  // Exactly one sticky note → show NoteToolbar
  if (count === 1) {
    const id = [...ids][0];
    const obj = snapshot.find(o => o.id === id);
    if (obj && obj.type === 'sticky') {
      const sticky = obj as StickySnapshot;
      return (
        <div
          data-testid="selection-bar"
          style={{
            position: 'absolute',
            top: -40,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <NoteToolbar
            color={sticky.color}
            onColor={(c: StickyColor) => {
              undo?.boundary();
              setStickyColor(doc, id, c);
              undo?.boundary();
            }}
            onDelete={() => {
              undo?.boundary();
              deleteObject(doc, id);
              undo?.boundary();
              onDelete();
            }}
          />
        </div>
      );
    }
    return null;
  }

  // Two or more → "N selected" + Delete
  return (
    <div
      data-testid="selection-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        background: 'white',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: 13,
        fontWeight: 500,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span
        aria-live="polite"
        data-testid="selection-count"
      >
        {count} selected
      </span>
      <button
        aria-label="Delete selection"
        data-testid="delete-selection-btn"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: '1px solid #ccc',
          background: 'white',
          cursor: 'pointer',
          fontSize: 14,
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
