import type { ReactElement } from 'react';
import { useBoard } from '@client/canvas/BoardContext';
import { StickyNote } from './StickyNote';
import type { ObjectSnapshot } from '@shared/board-model';
import type * as Y from 'yjs';
import type { SelectionApi } from '@client/board/useSelection';
import type { UndoController } from '@client/board/undo';

interface NoteLayerProps {
  notes: readonly ObjectSnapshot[];
  doc: Y.Doc;
  selection: SelectionApi;
  editable: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

export function NoteLayer({
  notes,
  doc,
  selection,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undoController,
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
          selected={selection.ids.has(note.id)}
          editing={note.id === selection.editingId}
          editable={editable}
          onObjectPointerDown={onObjectPointerDown}
          onSelect={selection.click}
          onToggle={selection.toggle}
          onStartEdit={onStartEdit}
          onEndEdit={onEndEdit}
          undoController={undoController}
        />
      ))}
    </>
  );
}
