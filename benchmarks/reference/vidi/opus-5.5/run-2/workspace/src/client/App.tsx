import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { BoardContext, type BoardContextValue } from './canvas/BoardContext';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState, ProviderFactory } from './sync/connectBoard';
import { createSticky, deleteObject } from '../shared/board-model';
import { BoardPage } from './pages/BoardPage';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useRoute } from './router';

const HALF = 2;

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** True when keyboard focus is somewhere that consumes typing or activation keys. */
function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest('input, textarea, select, button, [contenteditable="true"]') !== null;
}

/**
 * Whether the board may be changed (anchor: persist.client_status). False only while the
 * saved board cannot be loaded: editing an empty stand-in would look like lost work.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

export interface AppProps {
  /** Board to join live. Omitted: a local-only board (component tests). */
  boardId?: string;
  doc?: Y.Doc;
  createProvider?: ProviderFactory;
}

export function App(props: AppProps = {}): React.JSX.Element {
  const [viewport, setViewport] = useState<Size>(windowSize);
  const board = useCamera(viewport);
  const context = useMemo<BoardContextValue>(() => ({ board, setViewport }), [board]);
  const { camera } = board;
  const { doc, notes, connection } = useBoardDoc({
    boardId: props.boardId,
    doc: props.doc,
    createProvider: props.createProvider,
  });
  const editable = canEdit(connection);
  const selection = useSelection();
  // DOM order never changes when a note is brought to front (moving a DOM node would drop
  // its pointer capture mid-drag); stacking comes from each note's z-index instead.
  const renderOrder = useMemo(() => [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), [notes]);
  const { select, startEdit, endEdit } = selection;

  // A note that no longer exists (deleted here or, later, by someone else) cannot stay selected.
  const selectedExists = selection.selectedId !== null && notes.some((n) => n.id === selection.selectedId);
  const selectedId = selectedExists ? selection.selectedId : null;
  const editingId = editable && selectedExists && selection.editingId === selectedId ? selection.editingId : null;
  useEffect(() => {
    if (selection.selectedId !== null && !selectedExists) select(null);
  }, [selection.selectedId, selectedExists, select]);

  const createAt = useCallback(
    (world: Point) => {
      if (!editable) return;
      const id = createSticky(doc, world);
      if (id !== '') startEdit(id);
    },
    [doc, startEdit, editable],
  );

  const onCreateSticky = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / HALF, y: viewport.height / HALF }));
  }, [camera, viewport, createAt]);

  const onBackgroundClick = useCallback(() => select(null), [select]);

  // Enter edits the selected note; Delete/Backspace delete it (never while editing text).
  const keyState = useRef({ selectedId, editingId, editable });
  keyState.current = { selectedId, editingId, editable };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId: sel, editingId: edit, editable: canChange } = keyState.current;
      if (sel === null || edit !== null || !canChange || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInteractiveTarget(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(sel);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, sel);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, select, startEdit]);

  return (
    <BoardContext.Provider value={context}>
      <main className="app">
        <BoardViewport onBackgroundClick={onBackgroundClick} onBackgroundDoubleClick={createAt}>
          {renderOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              editable={editable}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={onCreateSticky} disabled={!editable} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
        <NavigationHint visible={!board.hasNavigated} />
        <ConnectionStatus state={connection} />
      </main>
    </BoardContext.Provider>
  );
}

/**
 * The page for the current address (anchor: share.pages): `/` home, `/b/:id` the board
 * (after an existence check), anything else Board not found. Boards are created only by
 * the Create a board action; no address creates one by being opened.
 */
export function Routes(): React.JSX.Element {
  const route = useRoute();
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'board':
      return <BoardPage key={route.id} id={route.id} />;
    case 'not_found':
      return <NotFoundPage />;
  }
}
