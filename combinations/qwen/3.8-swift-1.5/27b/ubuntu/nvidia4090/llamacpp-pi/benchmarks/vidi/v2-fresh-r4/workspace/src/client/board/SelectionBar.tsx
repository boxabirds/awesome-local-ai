import type { JSX } from 'react';
import type { ObjectSnapshot, StickySnapshot, TextSnapshot } from '../../shared/board-model';
import { NoteToolbar } from '../objects/NoteToolbar';
import { TextToolbar } from '../objects/TextToolbar';
import { type StickyColor, type TextSize } from '../../shared/config';
import * as Y from 'yjs';
import { deleteObject } from '../../shared/board-model';

export interface SelectionBarProps {
  ids: ReadonlySet<string>;
  snapshot: readonly ObjectSnapshot[];
  doc: Y.Doc;
  onDelete(): void;
  onColorChange(id: string, color: StickyColor): void;
  /** Text size change (story 9); its own undo step. */
  onTextSize?(id: string, size: TextSize): void;
  /** Delete a single text object (story 9); its own undo step. */
  onTextDelete?(id: string): void;
  /** Undo (story 8) — text toolbar. */
  onUndo?(): void;
  /** Redo (story 8) — text toolbar. */
  onRedo?(): void;
}

/**
 * Selection bar: shown above the selection bounding box.
 * - 2+ objects: "N selected" + Delete button
 * - Exactly 1 sticky note: NoteToolbar (colours + delete)
 * - Exactly 1 text object: TextToolbar (sizes + undo/redo + delete, story 9)
 * - 0 objects: nothing
 */
export function SelectionBar(props: SelectionBarProps): JSX.Element | null {
  const { ids, snapshot, doc, onDelete, onColorChange, onTextSize, onTextDelete, onUndo, onRedo } = props;

  if (ids.size === 0) return null;

  // Exactly one object → type-specific toolbar
  if (ids.size === 1) {
    const [id] = ids.values();
    const obj = snapshot.find((s) => s.id === id);
    if (obj && obj.type === 'sticky') {
      const sticky = obj as StickySnapshot;
      return (
        <NoteToolbar
          color={sticky.color}
          onColor={(c) => onColorChange(id, c)}
          onDelete={() => {
            deleteObject(doc, id);
            onDelete();
          }}
        />
      );
    }
    if (obj && obj.type === 'text') {
      const text = obj as TextSnapshot;
      return (
        <TextToolbar
          snap={text}
          doc={doc}
          onSize={(tid, size) => onTextSize?.(tid, size)}
          onDelete={() => onTextDelete?.(id)}
          onUndo={() => onUndo?.()}
          onRedo={() => onRedo?.()}
        />
      );
    }
  }

  // 2+ objects → "N selected" + Delete
  return (
    <div className="selection-bar" data-vidi6="selection-bar">
      <span className="selection-bar-count" aria-live="polite" data-vidi6="selection-count">
        {ids.size} selected
      </span>
      <button
        type="button"
        className="selection-bar-delete"
        aria-label="Delete selection"
        data-vidi6="selection-delete"
        onClick={onDelete}
      >
        🗑
      </button>
    </div>
  );
}
