import { useEffect, useState } from 'react';
import { createSticky, deleteObject } from '../shared/board-model';
import { newBoardId } from '../shared/board-id';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc, type BoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import type { Point } from './canvas/camera';
import { StickyNote } from './objects/StickyNote';

const TEXT_INPUT = 'input, textarea, select, [contenteditable]';
const ANY_CONTROL = `${TEXT_INPUT}, button`;

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/** Reads the board id from /b/:boardId; anything else redirects to a fresh board (until story 5). */
function boardIdFromLocation(): string {
  const match = BOARD_PATH.exec(location.pathname);
  if (match) return decodeURIComponent(match[1]);
  const id = newBoardId();
  history.replaceState(null, '', `/b/${id}`);
  return id;
}

/** False only while the saved board could not be loaded: it must not look like an empty editable board. */
export function canEdit(state: ConnectionState | undefined): boolean {
  return state !== 'load_failed';
}

export function App() {
  const [boardId] = useState(boardIdFromLocation);
  return <ConnectedBoard boardId={boardId} />;
}

function ConnectedBoard({ boardId }: { boardId: string }) {
  return <BoardApp board={useBoardDoc(boardId)} />;
}

/** The board UI over an existing document (tests supply their own to poke the model). */
export function BoardApp({ board }: { board: BoardDoc }) {
  const { doc, notes } = board;
  const sel = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = sel;

  const editable = canEdit(board.connection);

  const create = (centre: Point) => {
    if (!editable) return;
    const id = createSticky(doc, centre);
    if (id) startEdit(id);
  };

  // A selected or edited note that no longer exists (deleted elsewhere) is dropped silently.
  useEffect(() => {
    if (selectedId && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!editable || e.ctrlKey || e.metaKey || e.altKey || !selectedId || editingId !== null) return;
      const target = e.target instanceof Element ? e.target : null;
      if (e.key === 'Enter') {
        if (target?.closest(ANY_CONTROL)) return;
        e.preventDefault();
        startEdit(selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (target?.closest(TEXT_INPUT)) return;
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editable, selectedId, editingId, select, startEdit]);

  // DOM order is stable (by id) so pointer capture survives restacking; z-index does the stacking.
  const domOrder = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return (
    <>
    {board.connection && <ConnectionStatus state={board.connection} />}
    <BoardViewport
      onEmptyDoubleClick={create}
      onEmptyClick={() => select(null)}
      overlay={(ctx) => <Toolbar disabled={!editable} onCreateSticky={() => create(ctx.centreWorld())} />}
    >
      {(ctx) => domOrder.map((note) => (
        <StickyNote
          key={note.id}
          note={note}
          doc={doc}
          zoom={ctx.camera.zoom}
          selected={note.id === selectedId}
          editing={note.id === editingId}
          readOnly={!editable}
          onSelect={select}
          onStartEdit={startEdit}
          onEndEdit={endEdit}
        />
      ))}
    </BoardViewport>
    </>
  );
}
