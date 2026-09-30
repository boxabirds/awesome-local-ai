import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { createSticky, deleteObject, setStickyColor } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { type Point, type Size, canZoomIn, canZoomOut, screenToWorld, worldToScreen, zoomPercent } from './canvas/camera';
import { BoardViewport, isEditableTarget } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installTestHooks } from './canvas/testHooks';
import { BoardCameraContext, useCamera } from './canvas/useCamera';
import { NoteToolbar } from './objects/NoteToolbar';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';

function initialViewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const BOARD_PATH = /^\/b\/([^/]+)\/?$/;

/**
 * The board id from `/b/:boardId`. Any other address (e.g. `/`) is replaced with
 * a new board address — temporary until story 5 creates boards on the server.
 */
export function boardIdFromLocation(): string {
  const match = BOARD_PATH.exec(window.location.pathname);
  if (match?.[1] && isValidBoardId(match[1])) return match[1];
  const id = newBoardId();
  window.history.replaceState(null, '', `/b/${id}`);
  return id;
}

/**
 * `boardId` connects the board to its live room; without it the board stays
 * local. `doc` lets tests supply the board document; the app creates its own.
 */
export function App(props: { boardId?: string | null; doc?: Y.Doc } = {}): React.JSX.Element {
  const [viewportSize, setViewportSize] = useState<Size>(initialViewportSize);
  const board = useCamera(viewportSize);
  const context = useMemo(() => ({ ...board, setViewportSize }), [board]);
  const { camera } = board;
  const { doc, notes, connection } = useBoardDoc(props.boardId, props.doc);
  const selection = useSelection();
  const { selectedId, editingId, select, startEdit, endEdit } = selection;
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const selectedNote = notes.find((n) => n.id === selectedId) ?? null;
  // A note deleted while selected, dragged or edited leaves no stale selection behind.
  useEffect(() => {
    if (selectedId !== null && !notes.some((n) => n.id === selectedId)) select(null);
  }, [notes, selectedId, select]);

  useEffect(() => installTestHooks({ getNotes: () => [...notes] }), [notes]);
  const connectionStates = useRef<ConnectionState[]>([]);
  useEffect(() => {
    if (!props.boardId) return;
    connectionStates.current.push(connection);
    return installTestHooks({ connectionState: connection, connectionStates: connectionStates.current });
  }, [props.boardId, connection]);

  const createAt = useCallback(
    (world: Point) => {
      const id = createSticky(doc, world);
      if (id !== false) startEdit(id);
    },
    [doc, startEdit],
  );

  const createAtViewportCentre = () =>
    createAt(screenToWorld(camera, { x: viewportSize.width / 2, y: viewportSize.height / 2 }));

  // Enter edits the selected note; Delete/Backspace delete it — never while editing text.
  const keyState = useRef({ selectedId, editingId });
  keyState.current = { selectedId: selectedNote ? selectedId : null, editingId };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { selectedId: id, editingId: editing } = keyState.current;
      if (id === null || editing !== null || e.defaultPrevented) return;
      if (isEditableTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter') {
        // Enter on a focused button activates the button instead.
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        startEdit(id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteObject(doc, id);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, select, startEdit]);

  const showNoteToolbar = selectedNote !== null && editingId !== selectedNote.id && draggingId !== selectedNote.id;
  const toolbarAnchor = selectedNote
    ? worldToScreen(camera, { x: selectedNote.x + STICKY_SIZE_WORLD / 2, y: selectedNote.y })
    : null;

  return (
    <BoardCameraContext.Provider value={context}>
      <main className="app">
        <BoardViewport onEmptyDoubleClick={createAt} onEmptyClick={() => select(null)}>
          {[...notes].sort(byId).map((note) => (
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
              onDragChange={(dragging) => setDraggingId(dragging ? note.id : null)}
            />
          ))}
        </BoardViewport>
        {showNoteToolbar && toolbarAnchor && (
          <div className="note-toolbar-anchor" style={{ left: toolbarAnchor.x, top: toolbarAnchor.y }}>
            <NoteToolbar
              color={selectedNote.color}
              onColor={(color) => setStickyColor(doc, selectedNote.id, color)}
              onDelete={() => {
                deleteObject(doc, selectedNote.id);
                select(null);
              }}
            />
          </div>
        )}
        <Toolbar onCreateSticky={createAtViewportCentre} />
        {props.boardId && <ConnectionStatus state={connection} />}
        <NavigationHint visible={!board.hasNavigated} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => board.zoomStep('in')}
          onZoomOut={() => board.zoomStep('out')}
          onReset={board.reset}
        />
      </main>
    </BoardCameraContext.Provider>
  );
}
