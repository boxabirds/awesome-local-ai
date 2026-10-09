import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, snapshot } from '../shared/board-model';
import { registerBoardApi } from './testHooks';
import { BoardViewport, viewportCentre, type BoardSurface } from './canvas/BoardViewport';
import { screenToWorld } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';

/**
 * The board: the camera surface from story 1 plus the sticky note layer from
 * story 2. The Y.Doc, the selection and the toolbars are wired here; every
 * mutation goes through `src/shared/board-model.ts`.
 *
 * `doc` is injectable so component tests can inspect the exact same document
 * the UI writes to.
 */
export function App({ doc: providedDoc }: { doc?: Y.Doc } = {}) {
  const { doc, notes } = useBoardDoc(providedDoc);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [surface, setSurface] = useState<BoardSurface | null>(null);

  /** Create a note centred on a world point and start editing it right away. */
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      const id = createSticky(doc, world);
      if (id !== '') {
        startEdit(id);
      }
    },
    [doc, startEdit],
  );

  /** Toolbar creation: the centre of the visible board, wherever it is panned. */
  const createAtViewportCentre = useCallback(() => {
    if (!surface) {
      return;
    }
    // The surface centre is a screen point; the model wants the world point it shows.
    createAt(screenToWorld(surface.camera, viewportCentre(surface)));
  }, [createAt, surface]);

  const clearSelection = useCallback(() => select(null), [select]);

  // e2e hooks: read and create notes through the model (test build only).
  useEffect(() => {
    registerBoardApi({
      notes: () => [...snapshot(doc)],
      createNote: (params) => createSticky(doc, params.at, params.color),
    });
    return () => registerBoardApi(null);
  }, [doc]);

  // A selected or edited note that no longer exists (deleted elsewhere).
  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    if (!notes.some((note) => note.id === selectedId)) {
      select(null);
    }
  }, [notes, select, selectedId]);

  // Board keys: Enter edits the selected note, Delete/Backspace deletes it.
  useEffect(() => {
    const isTextEntry = (target: EventTarget | null): boolean =>
      target instanceof Element &&
      target.closest('input, textarea, select, [contenteditable="true"]') !== null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target) || isTextEntry(document.activeElement)) {
        return; // typing in a note (or any field) is not a board command
      }
      if (event.key === 'Enter') {
        if (editingId !== null || selectedId === null) {
          return; // TC-36: nothing selected, nothing happens
        }
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // While editing, Delete and Backspace edit characters in the note.
        if (editingId !== null || selectedId === null) {
          return;
        }
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editingId, select, selectedId, startEdit]);

  const zoom = surface?.camera.zoom ?? 1;

  return (
    <main className="app" data-app="vidi6">
      <BoardViewport
        onSurfaceChange={setSurface}
        onEmptyDoubleClick={createAt}
        onEmptyClick={clearSelection}
      >
        {notes.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={note.id === selectedId}
            editing={note.id === editingId}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} />
    </main>
  );
}
