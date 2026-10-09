import { useEffect, useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { useNoteKeys } from './board/useNoteKeys';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { isValidBoardId, newBoardId } from '../shared/board-id';

// Story 3 routing: the board lives at /b/<boardId>. '/' mints a fresh board
// id and replaces its own history entry (story 5 replaces this with proper
// board creation). An unparseable id is treated the same way as '/' — the
// client never sends it to the server.
function readBoardId(): string | null {
  const match = /^\/b\/([^/?#]+)/.exec(window.location.pathname);
  if (match === null) return null;
  const candidate = decodeURIComponent(match[1]);
  return isValidBoardId(candidate) ? candidate : null;
}

function boardIdFromLocation(): string {
  const existing = readBoardId();
  if (existing !== null) return existing;
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

export function App() {
  const [boardId, setBoardId] = useState<string | null>(() => boardIdFromLocation());
  useEffect(() => {
    const onPop = (): void => setBoardId(boardIdFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const { doc, notes, connection } = useBoardDoc(boardId ?? undefined);
  const selection = useSelection(doc);
  useNoteKeys(doc, selection);

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
      />
    </>
  );
}
