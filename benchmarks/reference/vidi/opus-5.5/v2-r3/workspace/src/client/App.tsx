import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { STICKY_SIZE_WORLD, type StickyColor } from '../shared/config';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { CameraContext, useCamera, type CameraContextValue } from './canvas/useCamera';
import { NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { installTestHooks } from './testHooks';

const HALF = 2;

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** True when keyboard input belongs to a text field or button rather than the board. */
function isInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
}

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/**
 * The board id from `/b/:boardId`. Any other address (including `/`) is
 * redirected to a new board; story 5 replaces this with server-side creation.
 */
function boardIdFromLocation(): string {
  const match = BOARD_PATH.exec(window.location.pathname);
  if (match && isValidBoardId(match[1])) return match[1];
  const id = newBoardId();
  window.history.replaceState(null, '', `/b/${id}`);
  return id;
}

export function App() {
  const [boardId] = useState(boardIdFromLocation);
  const [viewport, setViewport] = useState<Size>(windowSize);
  const api = useCamera(viewport);
  const { camera } = api;
  const { doc, notes, connection } = useBoardDoc(boardId);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  useEffect(() => {
    if (import.meta.env.MODE !== 'test') return;
    return installTestHooks({
      setCamera: api.setCamera,
      getCamera: () => cameraRef.current,
      doc,
      get connectionState() {
        return connectionRef.current;
      },
    });
  }, [api.setCamera, doc]);

  const ctx = useMemo<CameraContextValue>(() => ({ api, onViewportResize: setViewport }), [api]);

  // A note that disappears (deleted) ends any selection or editing of it.
  const selectedNote = notes.find((n) => n.id === selectedId);
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  const createAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [doc, startEdit],
  );

  const onCreateSticky = () => {
    createAt(screenToWorld(cameraRef.current, { x: viewport.width / HALF, y: viewport.height / HALF }));
  };

  const deleteNote = useCallback(
    (id: string) => {
      deleteObject(doc, id);
      select(null);
    },
    [doc, select],
  );

  // Board keys: Enter edits the selected note; Delete/Backspace deletes it (never while editing).
  const keyStateRef = useRef({ selectedId, editingId });
  keyStateRef.current = { selectedId, editingId };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInputTarget(e.target)) return;
      const { selectedId: sel, editingId: edit } = keyStateRef.current;
      if (edit !== null) return;
      // A note focused with Tab counts as selected for keyboard use.
      const focused =
        e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-note-id]')?.dataset.noteId : undefined;
      const id = focused ?? sel;
      if (!id) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        startEdit(id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteNote(id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [startEdit, deleteNote]);

  const onDragChange = useCallback((id: string, dragging: boolean) => {
    setDraggingId((cur) => (dragging ? id : cur === id ? null : cur));
  }, []);

  const showNoteToolbar = selectedNote && editingId === null && draggingId !== selectedNote.id;

  return (
    <CameraContext.Provider value={ctx}>
      <main className="app">
        <BoardViewport onEmptyDoubleClick={createAt} onEmptyClick={() => select(null)}>
          {renderOrder(notes).map(({ note, zIndex }) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              zIndex={zIndex}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
              onDragChange={(dragging) => onDragChange(note.id, dragging)}
            />
          ))}
          {showNoteToolbar && (
            <div
              className="note-toolbar-anchor"
              style={{
                left: selectedNote.x + STICKY_SIZE_WORLD / HALF,
                top: selectedNote.y,
                transform: `scale(${1 / camera.zoom})`,
                zIndex: notes.length + 1,
              }}
            >
              <NoteToolbar
                color={selectedNote.color}
                onColor={(c: StickyColor) => setStickyColor(doc, selectedNote.id, c)}
                onDelete={() => deleteNote(selectedNote.id)}
              />
            </div>
          )}
        </BoardViewport>
        <Toolbar onCreateSticky={onCreateSticky} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={api.reset}
        />
        <NavigationHint visible={!api.hasNavigated} />
        <ConnectionStatus state={connection} />
      </main>
    </CameraContext.Provider>
  );
}

/**
 * Stacking comes from the snapshot's (z, id) order via z-index, while DOM order
 * stays stable (by id) so bringing a note to front never re-parents the element
 * holding the pointer capture of a drag.
 */
function renderOrder<T extends { id: string }>(sorted: readonly T[]): { note: T; zIndex: number }[] {
  return sorted
    .map((note, i) => ({ note, zIndex: i + 1 }))
    .sort((a, b) => (a.note.id < b.note.id ? -1 : a.note.id > b.note.id ? 1 : 0));
}
