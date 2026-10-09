import { useEffect, useMemo } from 'react';
import { BoardViewport } from '../canvas/BoardViewport';
import { useBoardDoc } from '../board/useBoardDoc';
import { useSelection } from '../board/useSelection';
import { useBoardKeys } from '../board/useBoardKeys';
import { createUndo } from '../board/undo';
import { UndoContext } from '../board/useUndo';
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
  const selection = useSelection(notes);
  const editable = canEdit(connection);
  // One undo history per board doc, per session: created with the doc and
  // destroyed when this shell unmounts or the board changes.
  const undo = useMemo(() => createUndo(doc), [doc]);
  useEffect(() => () => undo.destroy(), [undo]);
  useBoardKeys({ doc, selection, snapshot: notes, canEdit: editable, undo });

  return (
    <>
      <ConnectionStatus state={connection} />
      <UndoContext.Provider value={undo}>
        <BoardViewport doc={doc} notes={notes} selection={selection} editable={editable} boardId={props.boardId} connection={connection} />
      </UndoContext.Provider>
    </>
  );
}
