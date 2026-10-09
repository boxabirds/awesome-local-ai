import { BoardViewport } from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useNoteKeys } from './board/useNoteKeys';

export function App() {
  const { doc, notes } = useBoardDoc();
  const selection = useSelection();
  useNoteKeys(doc, selection);

  return (
    <BoardViewport
      doc={doc}
      notes={notes}
      selectedId={selection.selectedId}
      editingId={selection.editingId}
      onSelect={selection.select}
      onStartEdit={selection.startEdit}
      onEndEdit={selection.endEdit}
    />
  );
}
