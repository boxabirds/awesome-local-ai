import type { JSX } from 'react';
import type { ObjectSnapshot, StickySnapshot } from '../../shared/board-model';
import type { TextSnapshot } from '../../shared/objects/text';
import type { TextSize } from '../../shared/config';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { deleteObjects } from '../../shared/board-model';
import type * as Y from 'yjs';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onDelete(): void;
  onColor(id: string, color: string): void;
  /** Text size change from the text toolbar (story 9). */
  onTextSize?(id: string, size: TextSize): void;
}

export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, doc, onDelete } = props;

  if (ids.size === 0) return null;

  // Exactly one object → show its type-specific toolbar
  if (ids.size === 1) {
    const id = [...ids][0];
    const obj = snapshot.find((o) => o.id === id);
    if (obj && obj.type === 'sticky') {
      const sticky = obj as StickySnapshot;
      return (
        <div
          data-testid="selection-bar"
          style={{
            position: 'absolute',
            top: -50,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <NoteToolbar
            color={sticky.color}
            onColor={(c) => props.onColor(id, c)}
            onDelete={() => {
              deleteObjects(doc, [id]);
              onDelete();
            }}
          />
        </div>
      );
    }
    if (obj && obj.type === 'text') {
      const text = obj as TextSnapshot;
      return (
        <div
          data-testid="selection-bar"
          style={{
            position: 'absolute',
            top: -50,
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <TextToolbar
            size={text.size}
            onSize={(s) => props.onTextSize?.(id, s)}
            onDelete={() => {
              deleteObjects(doc, [id]);
              onDelete();
            }}
          />
        </div>
      );
    }
    return null;
  }

  // Two or more → show "N selected" bar with Delete button
  return (
    <div
      data-testid="selection-bar"
      style={{
        position: 'absolute',
        top: -44,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'white',
        border: '1px solid #ddd',
        borderRadius: 6,
        padding: '4px 10px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        whiteSpace: 'nowrap',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span data-testid="selection-count" aria-live="polite">
        {ids.size} selected
      </span>
      <button
        aria-label="Delete selection"
        title="Delete selection"
        onClick={onDelete}
        style={{
          width: 24,
          height: 24,
          borderRadius: 4,
          border: '1px solid #ccc',
          backgroundColor: 'white',
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
