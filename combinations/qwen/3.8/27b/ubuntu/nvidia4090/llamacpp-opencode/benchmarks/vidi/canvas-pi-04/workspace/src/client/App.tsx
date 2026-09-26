// Story 2: wires the board together: the Y.Doc (useBoardDoc), the notes,
// selection state, keyboard shortcuts and the fixed UI (toolbar, zoom, hint).
//
// Story 3: the app is routed by board id — `/b/<boardId>` opens (or creates,
// for `/`) a shared board; the live badge reflects the connection state.

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { newBoardId, isValidBoardId } from '../shared/board-id';
import { createSticky, deleteObject, type StickySnapshot } from '../shared/board-model';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { useCamera, useWindowSize } from './canvas/useCamera';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { canEdit } from './sync/connectBoard';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'TEXTAREA' || tag === 'INPUT' || target.isContentEditable;
}

/** `/b/<id>` with a well-formed id, else null (the id is validated client-side too). */
function parseBoardId(pathname: string): string | null {
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match === null) return null;
  const id = match[1];
  return isValidBoardId(id) ? id : null;
}

export function App(): JSX.Element {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  // Back/forward navigation re-parses the route.
  useEffect(() => {
    const onPop = (): void => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const boardId = parseBoardId(pathname);

  // `/` mints a fresh board (the id IS the board — there is no server-side
  // lookup); any other unparseable path falls back to `/`.
  useEffect(() => {
    if (boardId === null) {
      const target = pathname === '/' ? `/b/${newBoardId()}` : '/';
      window.location.replace(target);
    }
  }, [boardId, pathname]);

  if (boardId === null) {
    return <div className="app-root" aria-busy="true" />;
  }
  return <Board boardId={boardId} />;
}

function Board(props: { boardId: string }): JSX.Element {
  const viewport = useWindowSize();
  const { camera, hasNavigated, zoomStep, reset } = useCamera(viewport);
  const { doc, notes, connectionState } = useBoardDoc(props.boardId);
  // Editing is locked out only while the board could not be loaded (story 4
  // persist.client_status): create/drag/edit/colour/delete are no-ops and the
  // Sticky note button is disabled. Selection stays available (read-only).
  const editable = canEdit(connectionState);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  // If the selected or editing note disappears (e.g. deleted by someone else),
  // end the interaction silently.
  useEffect(() => {
    const ids = new Set(notes.map((n: StickySnapshot) => n.id));
    if (selectedId !== null && !ids.has(selectedId)) select(null);
    if (editingId !== null && !ids.has(editingId)) endEdit('unselected');
  }, [notes, selectedId, editingId, select, endEdit]);

  // Window-level shortcuts (PRD sticky.select): Enter edits the selected
  // note; Delete/Backspace deletes it. Suppressed while typing in the editor.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Enter' && editable && selectedId !== null && editingId === null) {
        e.preventDefault();
        startEdit(selectedId);
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        editable &&
        selectedId !== null &&
        editingId === null
      ) {
        e.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, startEdit, select, doc, editable]);

  const createAtCenter = (): void => {
    if (!editable) return; // load_failed: create is a no-op
    const at = screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
    const id = createSticky(doc, at);
    if (id !== null) startEdit(id);
  };

  return (
    <div className="app-root">
      <BoardViewport
        onCreateStickyAt={(at) => {
          if (!editable) return; // load_failed: create is a no-op
          const id = createSticky(doc, at);
          if (id !== null) startEdit(id);
        }}
        onClearSelection={() => select(null)}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={camera.zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            canEdit={editable}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtCenter} canEdit={editable} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          if (canZoomIn(camera)) zoomStep('in');
        }}
        onZoomOut={() => {
          if (canZoomOut(camera)) zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
  );
}
