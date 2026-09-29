import { useEffect, useRef } from 'react';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { type Point, screenToWorld } from './canvas/camera';
import { isEditableTarget } from './canvas/isEditableTarget';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import type * as Y from 'yjs';

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/**
 * The board id from a `/b/:boardId` address. Any other address is replaced (without a new
 * history entry) by the address of a fresh board: temporary until story 5 creates boards.
 */
export function boardIdFromLocation(location: Location = window.location): string {
  const match = BOARD_PATH.exec(location.pathname);
  if (match && isValidBoardId(match[1])) return match[1];
  const boardId = newBoardId();
  window.history.replaceState(null, '', `/b/${boardId}${location.search}${location.hash}`);
  return boardId;
}

/**
 * Whether the board may be changed. Only a board that could not be loaded is locked: its
 * saved content is unknown, so it must not be presented as an empty editable board.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * `boardId` connects the board to its live room; without it (component tests) the board is
 * local only. `doc` lets tests supply the board document; the app creates its own.
 */
export function App(props: { boardId?: string; doc?: Y.Doc }) {
  const { doc, notes, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection();
  const { select, startEdit, endEdit } = selection;
  const editable = canEdit(connection);

  // A note deleted meanwhile is neither selected nor edited; nothing is while the board is locked.
  const exists = (id: string | null) => editable && id !== null && notes.some((n) => n.id === id);
  const selectedId = exists(selection.selectedId) ? selection.selectedId : null;
  const editingId = exists(selection.editingId) ? selection.editingId : null;
  const stale = selectedId !== selection.selectedId || editingId !== selection.editingId;
  useEffect(() => {
    if (stale) select(null);
  }, [stale, select]);

  const stateRef = useRef({ selectedId, editingId, editable });
  stateRef.current = { selectedId, editingId, editable };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId: id, editingId: editing, editable: canChange } = stateRef.current;
      if (!canChange || id === null || editing !== null) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Enter') {
        // Enter on a focused button activates the button instead.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        startEdit(id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, id);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, select, startEdit]);

  // Stacking follows (z, id) via CSS; DOM order is creation order so a drag never moves the node.
  const layers = new Map(notes.map((n, i) => [n.id, i + 1]));
  const domOrder = [...notes].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const createAt = (world: Point) => {
    if (!editable) return;
    const id = createSticky(doc, world);
    if (id) startEdit(id);
  };

  return (
    <>
      <BoardViewport
        onEmptyDoubleClick={createAt}
        onEmptyClick={() => select(null)}
        overlay={({ camera, viewport }) => (
          <Toolbar
            disabled={!editable}
            onCreateSticky={() =>
              createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }))
            }
          />
        )}
      >
        {({ camera }) =>
          domOrder.map((note) => (
            <StickyNote
              key={note.id}
              layer={layers.get(note.id)}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              editable={editable}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))
        }
      </BoardViewport>
      {props.boardId && <ConnectionStatus state={connection} />}
    </>
  );
}
