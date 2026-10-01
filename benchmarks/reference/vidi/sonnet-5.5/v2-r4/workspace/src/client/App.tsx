import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { StickyNote } from './objects/StickyNote';
import { setTestConnectionState } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { newBoardId } from '../shared/board-id';

function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
}

/** Board address from /b/:boardId; `/` is redirected to a fresh board (replaced by server-side creation in story 5). */
export function boardIdFromLocation(): string {
  const m = /^\/b\/([^/]+)\/?$/.exec(location.pathname);
  if (m) return decodeURIComponent(m[1]);
  const id = newBoardId();
  history.replaceState(null, '', `/b/${id}`);
  return id;
}

export function App({ doc: externalDoc, boardId }: { doc?: Y.Doc; boardId?: string }) {
  const { doc, notes, connection } = useBoardDoc(externalDoc, boardId);
  useEffect(() => setTestConnectionState(connection), [connection]);
  const sel = useSelection();

  const stateRef = useRef({ sel, doc });
  stateRef.current = { sel, doc };

  // Selection never outlives its note (e.g. deleted through the model).
  const { selectedId, editingId, select, endEdit } = sel;
  const selectedMissing = selectedId !== null && !notes.some((n) => n.id === selectedId);
  const editingMissing = editingId !== null && !notes.some((n) => n.id === editingId);
  useEffect(() => {
    if (editingMissing) endEdit('unselected');
    else if (selectedMissing) select(null);
  }, [selectedMissing, editingMissing, select, endEdit]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { sel: s, doc: d } = stateRef.current;
      if (s.selectedId === null || s.editingId !== null || isTextTarget(e.target)) return;
      if (e.key === 'Enter') {
        if (e.target instanceof HTMLElement && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        s.startEdit(s.selectedId);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(d, s.selectedId);
        s.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const create = (at: { x: number; y: number }) => {
    const id = createSticky(doc, at);
    if (id) sel.startEdit(id);
  };

  return (
    <>
    {boardId && <ConnectionStatus state={connection} />}
    <BoardViewport
      onDoubleClickEmpty={create}
      onClickEmpty={() => sel.select(null)}
      overlay={(ctx) => <Toolbar onCreateSticky={() => create(ctx.viewCentre)} />}
    >
      {(ctx) =>
        [...notes]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={ctx.camera.zoom}
              selected={sel.selectedId === note.id}
              editing={sel.editingId === note.id}
              onSelect={sel.select}
              onStartEdit={sel.startEdit}
              onEndEdit={sel.endEdit}
            />
          ))
      }
    </BoardViewport>
    </>
  );
}
