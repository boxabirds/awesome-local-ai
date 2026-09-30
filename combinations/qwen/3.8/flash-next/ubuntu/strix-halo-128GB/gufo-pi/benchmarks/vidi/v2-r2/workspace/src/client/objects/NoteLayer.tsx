import type { ReactElement } from 'react';
import { useBoard } from '@client/canvas/BoardContext';
import { StickyNote } from './StickyNote';
import type { StickySnapshot } from '@shared/board-model';
import type * as Y from 'yjs';

interface NoteLayerProps {
  notes: readonly StickySnapshot[];
  doc: Y.Doc;
  selectedId: string | null;
  editingId: string | null;
  editable: boolean;
  onSelect(id: string | null): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
}

export function NoteLayer({
  notes,
  doc,
  selectedId,
  editingId,
  editable,
  onSelect,
  onStartEdit,
  onEndEdit,
}: NoteLayerProps): ReactElement {
  const { camera } = useBoard();
  return (
    <>
      {notes.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          doc={doc}
          zoom={camera.zoom}
          selected={note.id === selectedId}
          editing={note.id === editingId}
          editable={editable}
          onSelect={onSelect}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
        />
      ))}
    </>
  );
}
