import { BoardViewport } from '../canvas/BoardViewport';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useNoteKeys } from '../board/useNoteKeys';
import { ConnectionStatus } from '../sync/ConnectionStatus';
import type { ConnectionState } from '../sync/connectBoard';

// The board is read-only only while the server cannot load it; every other
// connection state (including reconnecting) keeps editing enabled.
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

// The stories 1–4 board, mounted by BoardPage once the board is known to
// exist. Kept separate from the page shell so the existence states (checking,
// not found, unreachable) never construct a document or a connection.
export function BoardShell(props: { boardId: string }) {
  const { doc, notes, connection } = useBoardDoc(props.boardId);
  const selection = useSelection(doc);
  useNoteKeys(doc, selection, canEdit(connection));

  return (
    <>
      <ConnectionStatus state={connection} />
      <BoardViewport
        doc={doc}
        notes={notes}
        selectedId={selection.selectedId}
        editingId={selection.editingId}
        onSelect={selection.select}
        onStartEdit={selection.startEdit}
        onEndEdit={selection.endEdit}
        editable={canEdit(connection)}
      />
    </>
  );
}
