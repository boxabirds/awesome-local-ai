import { useCallback, useEffect } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera, useViewportSize } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { installTestHooks } from './canvas/testHooks';
import { ConnectionStatus } from './sync/ConnectionStatus';

/** True when the keypress belongs to a text field, which owns Delete and Enter itself. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** Extract the boardId from /b/:boardId. */
function readBoardIdFromPath(): string | undefined {
  const match = window.location.pathname.match(/^\/b\/([^/]+)/);
  return match?.[1];
}

/**
 * Top-level layout: a full-window board, the tool toolbar on the left, the zoom control in the
 * bottom-right corner and the first-use navigation hint near the bottom centre.
 *
 * The camera lives here so the board and its controls share one source of truth, the board
 * document lives in `useBoardDoc` (in memory in this story), and selection lives in
 * `useSelection` (never shared). The window keyboard handler is the single place that turns
 * Enter / Delete / Backspace into a board action for the selected note.
 */
export interface AppProps {
  /**
   * Use this board document instead of creating one. Tests seed a document and render it;
   * from story 3 on this is also where a provider-backed document comes from.
   */
  doc?: Y.Doc;
  /** Board id for connecting to the server. If absent, no provider is connected. */
  boardId?: string;
}

export function App({ doc: providedDoc, boardId: boardIdProp }: AppProps = {}) {
  const viewport = useViewportSize();
  const { camera, hasNavigated, ...handlers } = useCamera(viewport);
  const boardId = boardIdProp ?? readBoardIdFromPath();
  const { doc, notes, connectionState } = useBoardDoc(providedDoc, boardId);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;

  /** Create a note whose centre is the given world point, and start typing straight away. */
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      const id = createSticky(doc, world);
      if (!id) return;
      startEdit(id);
    },
    [doc, startEdit],
  );

  /** Toolbar creation: the centre of the visible board area, wherever the board is panned. */
  const createAtViewportCentre = useCallback(() => {
    createAt(screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [camera, createAt, viewport.height, viewport.width]);

  /** Bin button and Delete key: remove the note and drop the selection with it. */
  const remove = useCallback(
    (id: string) => {
      deleteObject(doc, id);
      select(null);
    },
    [doc, select],
  );

  // Enter starts editing the selected note; Delete/Backspace removes it. Both are ignored while
  // a note is being edited (the keys belong to the textarea) or while focus is in any field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingId !== null) return;
      if (isTypingTarget(event.target)) return;
      if (selectedId === null) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        remove(selectedId);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editingId, remove, selectedId, startEdit]);

  // A note that is gone cannot stay selected (deleted by the bin button, the keyboard, or from
  // story 3 on by someone else): the selection follows the document.
  useEffect(() => {
    if (selectedId !== null && !notes.some((note) => note.id === selectedId)) select(null);
  }, [notes, select, selectedId]);

  // A note that is gone cannot stay in edit mode (deleted by someone else).
  useEffect(() => {
    if (editingId !== null && !notes.some((note) => note.id === editingId)) endEdit('unselected');
  }, [notes, editingId, endEdit]);

  // Test build only: let the suites read the model, so a drag can be asserted in world units.
  useEffect(() => {
    installTestHooks({ getStickyNotes: () => snapshot(doc) });
  }, [doc]);

  // Expose connection state for e2e tests.
  useEffect(() => {
    if (connectionState !== undefined) {
      installTestHooks({ connectionState });
    }
  }, [connectionState]);

  return (
    <div className="app-root">
      {connectionState !== undefined && <ConnectionStatus state={connectionState} />}
      <BoardViewport
        camera={camera}
        handlers={handlers}
        onCreateSticky={createAt}
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
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            onDelete={remove}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => handlers.zoomStep('in')}
        onZoomOut={() => handlers.zoomStep('out')}
        onReset={handlers.reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
