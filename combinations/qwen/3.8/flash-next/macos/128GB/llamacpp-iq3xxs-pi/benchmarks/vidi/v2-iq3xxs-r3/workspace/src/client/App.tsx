import { useCallback, useEffect } from 'react';
import type { JSX } from 'react';

import { BoardViewport } from './canvas/BoardViewport';
import { CameraProvider, useBoard } from './canvas/CameraProvider';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { Toolbar } from './board/Toolbar';
import { createSticky, deleteObject } from '../shared/board-model';
import type { Point } from './canvas/camera';
import { StickyNote } from './objects/StickyNote';

/** Zoom chrome wired to the board camera. */
function BoardZoomControls(): JSX.Element {
  const board = useBoard();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(board.camera)}
      canZoomIn={canZoomIn(board.camera)}
      canZoomOut={canZoomOut(board.camera)}
      onZoomIn={() => board.zoomStep('in')}
      onZoomOut={() => board.zoomStep('out')}
      onReset={board.reset}
    />
  );
}

/** First-use hint, hidden by the first pan or zoom of the visit. */
function BoardNavigationHint(): JSX.Element | null {
  const { hasNavigated } = useBoard();
  return <NavigationHint visible={!hasNavigated} />;
}

declare global {
  interface Window {
    /** Test-only: mutate the board document as another client would. */
    __vidi6Board?: { deleteNote(id: string): boolean };
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export interface BoardContentsProps {
  /** Use an existing document instead of owning one (component tests). */
  doc?: import('yjs').Doc;
}

/**
 * Everything inside the camera context: the board document, the local
 * selection, the notes inside the viewport and the window keyboard wiring
 * (Enter starts editing, Delete/Backspace delete the selected note — never
 * while its text is being edited).
 */
export function BoardContents({ doc }: BoardContentsProps = {}): JSX.Element {
  const board = useBoard();
  const { doc: document, notes } = useBoardDoc(doc);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  /** Create a note centred on a world point, selected and in edit mode. */
  const createAndEdit = useCallback(
    (world: Point): void => {
      const id = createSticky(document, world);
      if (typeof id !== 'string') return; // non-finite point: nothing happens
      select(id);
      startEdit(id);
    },
    [document, select, startEdit],
  );

  // Test-only hook, dropped from production builds: lets e2e tests delete a
  // note behind the client's back, as a collaborator would (stale
  // interactions, TC-37; there is no second client until story 3).
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    window.__vidi6Board = {
      deleteNote: (noteId: string) => deleteObject(document, noteId),
    };
    return () => {
      delete window.__vidi6Board;
    };
  }, [document]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Delete/Backspace while editing go to the text, never the note
      // (sticky.delete), and neither key acts on behalf of an input.
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Enter') {
        if (editingId !== null || selectedId === null) return; // TC-36
        event.preventDefault();
        startEdit(selectedId);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingId !== null || selectedId === null) return;
        event.preventDefault();
        deleteObject(document, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [document, editingId, selectedId, select, startEdit]);

  return (
    <>
      <BoardViewport
        onEmptySpaceClick={() => {
          select(null);
        }}
        onEmptySpaceDoubleClick={createAndEdit}
      >
        {/* Render in creation order, never in snapshot (z) order: restacking
            mid-drag would make React move the dragged element in the DOM,
            which drops pointer capture and kills the drag. Stacking itself
            comes from the note's own zIndex style. */}
        {[...notes]
          .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
          .map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={document}
            zoom={board.camera.zoom}
            selected={selectedId === note.id}
            editing={editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar
        onCreateSticky={() => {
          // Centre of the visible board area, wherever the board is panned
          // (sticky.create_button, TC-34).
          const centre: Point = {
            x: board.viewport.width / 2,
            y: board.viewport.height / 2,
          };
          createAndEdit(screenToWorld(board.camera, centre));
        }}
      />
    </>
  );
}

export function App(): JSX.Element {
  return (
    <div className="board-app" data-testid="board-app">
      <CameraProvider>
        <BoardContents />
        <BoardZoomControls />
        <BoardNavigationHint />
      </CameraProvider>
    </div>
  );
}
