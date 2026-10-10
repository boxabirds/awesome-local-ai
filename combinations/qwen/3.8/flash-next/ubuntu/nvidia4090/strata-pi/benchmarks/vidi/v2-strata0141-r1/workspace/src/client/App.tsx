import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, getStickyText, snapshot } from '../shared/board-model';
import { registerBoardApi, registerSeedApi } from './testHooks';
import { STICKY_COLOR_NAMES } from '../shared/config';
import { BoardViewport, viewportCentre, type BoardSurface } from './canvas/BoardViewport';
import { screenToWorld } from './canvas/camera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { BoardProvider } from './sync/connectBoard';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';

/**
 * The board: the camera surface from story 1 plus the sticky note layer from
 * story 2. The Y.Doc, the selection and the toolbars are wired here; every
 * mutation goes through `src/shared/board-model.ts`.
 *
 * `doc` is injectable so component tests can inspect the exact same document the
 * UI writes to, and `connect` can be turned off so a component test never opens
 * a socket. Story 3 adds the live connection and its status badge.
 */
export interface AppProps {
  /** A document to render instead of creating one (component tests). */
  doc?: Y.Doc;
  /** The board this page is on. */
  boardId: string;
  /** False keeps the room connection away (component tests). */
  connect?: boolean;
  /** A fake room connection, for UI-component tests. */
  providerFactory?: (url: string, boardId: string, doc: Y.Doc) => BoardProvider;
}

export function App({
  doc: providedDoc,
  boardId,
  connect = true,
  providerFactory,
}: AppProps) {
  const { doc, notes, connectionState } = useBoardDoc({
    doc: providedDoc,
    boardId,
    connect,
    providerFactory,
  });
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const [surface, setSurface] = useState<BoardSurface | null>(null);

  /**
   * A board the room could not load is not editable (`persist.client_status`).
   * Editing a copy of a board we have not been given would put changes somewhere
   * they cannot be saved and cannot be seen, so every mutation entry point is
   * closed while `connectionState` is `load_failed`. Reconnecting needs no page
   * reload: the same page edits again as soon as the room serves the board.
   */
  const editable = connectionState !== 'load_failed';

  /** Create a note centred on a world point and start editing it right away. */
  const createAt = useCallback(
    (world: { x: number; y: number }) => {
      if (!editable) {
        return;
      }
      const id = createSticky(doc, world);
      if (id !== '') {
        startEdit(id);
      }
    },
    [doc, editable, startEdit],
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

  /** Starting to edit is a mutation too: a note's text is the document. */
  const editNote = useCallback(
    (id: string) => {
      if (!editable) {
        return;
      }
      startEdit(id);
    },
    [editable, startEdit],
  );

  // e2e hooks: read and create notes through the model (test build only).
  useEffect(() => {
    registerBoardApi({
      notes: () => [...snapshot(doc)],
      createNote: (params) => {
        const id = createSticky(doc, params.at, params.color);
        if (id !== '' && params.text !== undefined) {
          getStickyText(doc, id)?.insert(0, params.text);
        }
        return id;
      },
      connectionState: () => connectionState,
    });
    // Seeding a big board is one transaction, so a test sets up a board the size
    // of a real one without spending one update per note.
    registerSeedApi({
      seed: (params) => {
        const columns = Math.max(
          1,
          Math.ceil(Math.sqrt(params.count * (params.area.width / Math.max(1, params.area.height)))),
        );
        doc.transact(() => {
          for (let index = 0; index < params.count; index += 1) {
            const column = index % columns;
            const row = Math.floor(index / columns);
            createSticky(
              doc,
              {
                x: params.area.x + (column + 0.5) * (params.area.width / columns),
                y: params.area.y + (row + 0.5) * (params.area.height / Math.max(1, Math.ceil(params.count / columns))),
              },
              STICKY_COLOR_NAMES[index % STICKY_COLOR_NAMES.length],
            );
          }
        });
        return params.count;
      },
    });
    return () => {
      registerBoardApi(null);
      registerSeedApi(null);
    };
  }, [doc, connectionState]);

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
      if (!editable) {
        return; // a board that could not be loaded is not edited (TC-23)
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
  }, [doc, editable, editingId, select, selectedId, startEdit]);

  const zoom = surface?.camera.zoom ?? 1;

  return (
    <main className="app" data-app="vidi6" data-testid="app" data-board-editable={editable ? 'true' : 'false'}>
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
            editable={editable}
            onSelect={select}
            onStartEdit={editNote}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createAtViewportCentre} disabled={!editable} />
      <ConnectionStatus state={connectionState} />
    </main>
  );
}
