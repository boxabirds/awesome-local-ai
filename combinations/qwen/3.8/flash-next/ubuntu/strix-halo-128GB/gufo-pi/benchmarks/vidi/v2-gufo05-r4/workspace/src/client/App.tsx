/**
 * The board screen: the infinite canvas from story 1 with the sticky notes of
 * story 2 on top of it.
 *
 * This component is where the three pieces of state meet — the camera (per
 * visit), the document (the board's content) and the selection (per client) —
 * and where the board-wide keyboard shortcuts live. Everything that changes a
 * note goes through `src/shared/board-model.ts`.
 *
 * The address *is* the board (`/b/<boardId>`, story 3). Opening `/` starts a board
 * of your own; story 5 replaces that with a server-side "new board" endpoint and
 * a share link.
 */

import { useCallback, useEffect, useRef, type JSX } from 'react';
import type * as Y from 'yjs';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection, type SelectionControls } from './board/useSelection';
import { screenToWorld, canZoomIn, canZoomOut, zoomPercent, type Point } from './canvas/camera';
import { registerTestHooks } from './canvas/testHooks';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { reportConnectionState } from './canvas/testHooks';
import { canEdit } from './sync/connectBoard';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { CameraProvider, useCameraContext } from './canvas/useCamera';
import { StickyNote } from './objects/StickyNote';

export interface AppProps {
  /**
   * A board document to use instead of making one. Tests pass a private `Y.Doc`
   * so they can assert on what was stored; story 3 will pass the document that is
   * synced with a room.
   */
  doc?: Y.Doc;
}

export function App(props: AppProps = {}): JSX.Element {
  return (
    <CameraProvider>
      <Board doc={props.doc} />
    </CameraProvider>
  );
}

/**
 * The board in the address bar. `/b/<boardId>` is that board; anything else (only
 * `/` in practice) becomes a fresh, unguessable address in the history entry
 * without adding a navigation step.
 */
function boardIdFromLocation(): string {
  const match = /^\/b\/([^/?#]+)/.exec(window.location.pathname);
  if (match) {
    let candidate: string;
    try {
      candidate = decodeURIComponent(match[1]);
    } catch {
      candidate = '';
    }
    if (isValidBoardId(candidate)) return candidate;
  }
  const fresh = newBoardId();
  window.history.replaceState(null, '', `/b/${fresh}`);
  return fresh;
}

/** Is the caret somewhere the user is typing? Then the keys are theirs. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Is the key press addressed to a control rather than to the board? A button
 * handles Enter and Space itself, and Delete on a focused swatch must not delete
 * the note it belongs to.
 */
function isControl(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest('button, a, select, [role="toolbar"]') !== null;
}

/**
 * The board: notes in world space, the tool palette on the left, the zoom
 * control in the corner and the first-use hint until the user moves.
 */
function Board(props: { doc?: Y.Doc }): JSX.Element {
  const { camera, viewport, hasNavigated, zoomStep, reset } = useCameraContext();
  // A document handed in by a test is never put on the network: no board id, no
  // provider, and the connection reads `connected`.
  const boardId = props.doc ? undefined : boardIdFromLocation();
  const { doc, notes, connection } = useBoardDoc({ boardId, doc: props.doc });
  const selection = useSelection();

  // Handlers registered once read the live selection through a ref.
  const selectionRef = useRef<SelectionControls>(selection);
  selectionRef.current = selection;

  // Story 4: a board the room could not load is not a board to write on. Everything
  // that would change the document is checked against this, and the handlers that are
  // registered once read it through a ref.
  const editable = canEdit(connection);
  const editableRef = useRef(editable);
  editableRef.current = editable;

  /** Put a new note in the middle of a screen point and start typing it. */
  const createAt = useCallback(
    (screenPoint: Point, document: Y.Doc, startEdit: (id: string) => void) => {
      const id = createSticky(document, screenToWorld(camera, screenPoint));
      if (!id) return;
      startEdit(id);
    },
    [camera]
  );

  const createAtScreenCentre = useCallback(() => {
    if (!editableRef.current) return;
    createAt({ x: viewport.width / 2, y: viewport.height / 2 }, doc, selectionRef.current.startEdit);
  }, [createAt, doc, viewport.height, viewport.width]);

  // Test builds expose what the document holds and how the connection looks, so
  // e2e asserts on real state rather than guessing it from the screen.
  useEffect(() => registerTestHooks({ getBoard: () => snapshot(doc) }), [doc]);
  useEffect(() => reportConnectionState(connection), [connection]);

  // A selection or an open editor that refers to a note that is no longer on the
  // board is dropped, so nothing can act on a stale id. Somebody else deleting the
  // note you are typing in ends the edit quietly: no dialog, no error (`live.delete_during_edit`).
  useEffect(() => {
    const { selectedId, editingId } = selectionRef.current;
    const gone = (id: string | null) => id !== null && !notes.some((note) => note.id === id);
    if (gone(editingId)) selectionRef.current.endEdit('unselected');
    else if (gone(selectedId)) selectionRef.current.select(null);
  }, [notes]);

  // An editor that was open when the board became unwritable is closed, rather than
  // left typing into a document that is about to be replaced by what the room reads.
  useEffect(() => {
    if (!editable && selectionRef.current.editingId) selectionRef.current.endEdit('selected');
  }, [editable]);

  // Board-wide keys: Enter edits the selected note, Delete and Backspace remove
  // it. While a note is being typed into they are not ours at all.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!editableRef.current) return;
      if (selectionRef.current.editingId) return;
      if (isTextEntry(event.target) || isControl(event.target)) return;

      const selectedId = selectionRef.current.selectedId;
      if (!selectedId) return; // nothing selected: the keys do nothing

      if (event.key === 'Enter') {
        event.preventDefault();
        selectionRef.current.startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        // A note that vanished between events is just no longer there.
        if (deleteObject(doc, selectedId)) selectionRef.current.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc]);

  const { select, startEdit, endEdit } = selection;

  return (
    <>
      <BoardViewport
        doc={doc}
        canCreateSticky={editable}
        onStickyCreated={startEdit}
        onEmptyClick={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            canEdit={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtScreenCentre} disabled={!editable} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connection} />
    </>
  );
}
