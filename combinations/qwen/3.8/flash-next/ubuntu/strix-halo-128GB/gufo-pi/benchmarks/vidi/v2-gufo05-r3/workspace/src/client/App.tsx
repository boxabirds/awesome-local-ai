import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardViewport, type BoardViewportApi } from './canvas/BoardViewport';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { installBoardHook, reportConnectionState } from './canvas/testHooks';

export interface AppProps {
  /**
   * Board document to render. Omitted in production, where `useBoardDoc`
   * creates one; tests pass a document they can seed and assert on. A document
   * passed in from outside is kept local (no room connection), which is what
   * component tests need.
   */
  doc?: Y.Doc;
  /**
   * Board to connect to. Omitted in production, where it comes from the address
   * bar (`/b/:boardId`).
   */
  boardId?: string;
}

/** The board address shape: `/b/<boardId>`. */
const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/**
 * The board id carried by an address, or `null` when the address does not name
 * a board (`/`, a malformed or unguessable id). Story 5 replaces the `null`
 * case with server-side board creation and a "board not found" page.
 */
export function boardIdFromPathname(pathname: string): string | null {
  const match = BOARD_PATH.exec(pathname);
  if (!match) return null;
  return isValidBoardId(match[1]) ? match[1] : null;
}

/** True when the keyboard belongs to a text field (so keys edit text). */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * True when the key belongs to a focused control (a toolbar button, a link ...):
 * Enter and Space must activate that control instead of being turned into board
 * shortcuts.
 */
function isControlTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a[href], [role="button"]') !== null;
}

/**
 * The board this tab is on, read from the address bar.
 *
 * An address that does not name a board (notably `/`) opens a fresh board and
 * puts its address in the bar, so the tab has something to sync on. This is a
 * stand-in: story 5 creates boards server-side.
 */
function useBoardRoute(enabled: boolean): string | null {
  const [boardId, setBoardId] = useState<string | null>(() =>
    boardIdFromPathname(window.location.pathname),
  );

  useEffect(() => {
    if (!enabled || boardId !== null) return;
    const id = newBoardId();
    window.history.replaceState(null, '', `/b/${id}`);
    setBoardId(id);
  }, [enabled, boardId]);

  useEffect(() => {
    const onPopState = () => setBoardId(boardIdFromPathname(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return boardId;
}

/**
 * Composition root: the board document, the live connection, the local
 * selection, the toolbars and the board shortcuts, wired into the viewport.
 */
export default function App({ doc, boardId }: AppProps = {}) {
  const routeBoardId = useBoardRoute(doc === undefined);
  const { doc: boardDoc, notes, connection } = useBoardDoc(
    doc,
    boardId ?? routeBoardId ?? undefined,
  );
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const viewportApi = useRef<BoardViewportApi | null>(null);

  /** A newly created note (button or double-click) is selected and edited. */
  const openForEditing = useCallback((id: string) => startEdit(id), [startEdit]);

  const createStickyAtCentre = useCallback(() => {
    const centre = viewportApi.current?.viewportCentreWorld() ?? { x: 0, y: 0 };
    const id = createSticky(boardDoc, centre);
    if (id) startEdit(id);
  }, [boardDoc, startEdit]);

  // Board shortcuts: Enter starts editing the selected note, Delete/Backspace
  // removes it. While a note's text is being edited these keys belong to the
  // textarea, so the note is never deleted by accident; with a toolbar button
  // focused Enter belongs to that button (Delete still works, it is not a key a
  // button answers to).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (editingId !== null) return;
      if (selectedId === null) return;
      if (e.key === 'Enter') {
        if (isControlTarget(e.target)) return;
        e.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(boardDoc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [boardDoc, selectedId, editingId, select, startEdit]);

  // Read-only board model and connection state for the e2e tests (test builds).
  useEffect(() => {
    installBoardHook(() => snapshot(boardDoc));
  }, [boardDoc]);
  useEffect(() => {
    reportConnectionState(connection);
  }, [connection]);

  // A note that disappears (deleted here, or by somebody else while I am typing
  // in it or dragging it) must not stay selected and must not keep an editor
  // open. Ending both is silent: no error, no message (PRD live.delete_during_edit).
  useEffect(() => {
    const gone = (id: string) => !notes.some((note) => note.id === id);
    if (editingId !== null && gone(editingId)) endEdit('unselected');
    if (selectedId !== null && gone(selectedId)) select(null);
  }, [notes, selectedId, editingId, select, endEdit]);

  // Painting order for the DOM: creation order, so a note never jumps around in
  // the tree while it is dragged (its `zIndex` does the stacking, see StickyNote).
  const paintOrder = useMemo(
    () =>
      [...notes].sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }),
    [notes],
  );

  return (
    <main className="app" data-testid="app-root">
      <ConnectionStatus state={connection} />
      <Toolbar onCreateSticky={createStickyAtCentre} />
      <BoardViewport
        doc={boardDoc}
        viewportApi={viewportApi}
        onStickyCreated={openForEditing}
        onClearSelection={() => select(null)}
      >
        {({ zoom }) =>
          // DOM order is stable (creation order) and stacking comes from
          // `zIndex: note.z`: re-ordering the DOM mid-drag would move the element
          // that holds the pointer capture and cancel the drag.
          paintOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={boardDoc}
              zoom={zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))
        }
      </BoardViewport>
    </main>
  );
}
