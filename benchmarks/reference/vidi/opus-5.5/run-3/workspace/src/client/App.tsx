import { useCallback, useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { screenToWorld, type Point } from './canvas/camera';
import { installTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { useRoute } from './router';
import { HomePage } from './pages/HomePage';
import { BoardPage } from './pages/BoardPage';
import { NotFoundPage } from './pages/NotFoundPage';

/** Whether the board may be edited: not while its saved state cannot be loaded (never over an empty stand-in). */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

function isTextField(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

/** Routes `/` to the home page, `/b/:boardId` to that board (or Board not found), anything else to not found. */
export function Root() {
  const route = useRoute();
  if (route.name === 'home') return <HomePage />;
  if (route.name === 'board') return <BoardPage key={route.id} id={route.id} />;
  return <NotFoundPage />;
}

/**
 * One board. With `boardId` it is live-synced with everyone else on that board.
 * `doc` lets tests supply their own document; the app creates one.
 */
export function App(props: { boardId?: string; doc?: Y.Doc } = {}) {
  const { doc, notes, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection();
  const { select, startEdit, endEdit } = selection;
  const editable = canEdit(connection);

  // A selected or edited note that no longer exists (deleted) is simply no longer selected.
  const exists = (id: string | null) => id !== null && notes.some((n) => n.id === id);
  const selectedId = exists(selection.selectedId) ? selection.selectedId : null;
  const editingId = editable && exists(selection.editingId) ? selection.editingId : null;
  useEffect(() => {
    if (selection.selectedId !== null && selectedId === null) select(null);
  }, [selection.selectedId, selectedId, select]);

  // Notes are drawn in a stable DOM order (by id) and stacked with z-index from their (z, id) rank.
  // Re-ordering DOM nodes instead would make browsers drop pointer capture when a dragged note comes to the front.
  const stacked = useMemo(() => {
    const rank = new Map(notes.map((n, i) => [n.id, i + 1]));
    const byId = [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return byId.map((note) => ({ note, stackIndex: rank.get(note.id)! }));
  }, [notes]);

  useEffect(() => {
    if (!editable && selection.editingId !== null) endEdit('selected');
  }, [editable, selection.editingId, endEdit]);

  const state = useRef({ selectedId, editingId, editable });
  state.current = { selectedId, editingId, editable };

  const createAt = useCallback(
    (world: Point) => {
      if (!state.current.editable) return;
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  // Enter edits the selected note; Delete/Backspace delete it. Never while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId: sel, editingId: editing, editable: canChange } = state.current;
      if (sel === null || editing !== null || !canChange) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isTextField(e.target)) return;
      if (e.key === 'Enter') {
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
        // Prevent the default so this Enter is not also typed into the editor that is about to open.
        e.preventDefault();
        startEdit(sel);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, sel);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, startEdit]);

  useEffect(() => installTestHooks({ notes: () => snapshot(doc) }), [doc]);
  useEffect(() => installTestHooks({ connectionState: connection }), [connection]);

  return (
    <BoardViewport
      onDoubleClickEmpty={createAt}
      onEmptyClick={() => select(null)}
      overlay={({ camera, size }) => (
        <>
          <Toolbar
            disabled={!editable}
            onCreateSticky={() => createAt(screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }))}
          />
          <ConnectionStatus state={connection} />
        </>
      )}
    >
      {({ camera }) =>
        stacked.map(({ note, stackIndex }) => (
          <StickyNote
            key={note.id}
            note={note}
            stackIndex={stackIndex}
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
  );
}
