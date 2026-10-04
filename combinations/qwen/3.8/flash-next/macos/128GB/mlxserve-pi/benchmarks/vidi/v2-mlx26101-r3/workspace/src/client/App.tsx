import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import * as Y from 'yjs';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
  type Camera,
  type Point,
  type Size,
} from './canvas/camera';
import { useCamera } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectBoard';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';

function initialViewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * True when the keyboard belongs to something that types text - the note's textarea, or
 * any future input - so board shortcuts never eat a character or a backspace.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const name = target.tagName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || target.isContentEditable;
}

export interface AppProps {
  /**
   * The board to show, as named by the address. Left out, the document is not connected to a
   * room at all - which is what a component test does with a document of its own, and what
   * happens on an address that names no board.
   */
  boardId?: string;
  /**
   * Board document to render. Left out in production, where the app owns one; tests pass
   * a document they can read and drive directly, which is also how story 3's two-peer test
   * and story 4's loaded board will be mounted.
   */
  doc?: Y.Doc;
}

/**
 * Whether the user may write to the board in this connection state.
 *
 * Everything except `load_failed` leaves the board editable, including a connection that is
 * down: those edits go into the local document and reach the room when the connection does.
 * `load_failed` is different in kind - the room could not read the board, so what is on screen
 * is not known to be anybody's board, and an edit made on it would be built on a state nobody
 * can vouch for. That is why this one state stops the tools instead of merely explaining itself.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * Top-level layout: the infinite board fills the window, the tools are docked top-left,
 * the zoom control in the bottom-right corner and the first-use hint near the bottom
 * centre.
 *
 * Wiring follows from there being one source of truth: the document. Double-click and
 * the toolbar button add notes through the board model, notes re-render from the snapshot
 * the document gives them, and nothing here holds a copy of a note.
 */
export function App({ boardId, doc: injectedDoc }: AppProps = {}): JSX.Element {
  const [viewport, setViewport] = useState<Size>(initialViewport);
  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, gesture, zoomStep, reset } =
    useCamera(viewport);
  const { doc, notes, connection } = useBoardDoc(boardId, injectedDoc);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();
  const editable = canEdit(connection);

  // The editable flag is read inside callbacks and window listeners that are not rebuilt when it
  // changes, so they read it from a ref rather than from a copy taken when they were made.
  const canEditRef = useRef(editable);
  useEffect(() => {
    canEditRef.current = editable;
  });

  // The camera is needed inside event handlers that are attached to the window.
  const cameraRef = useRef<Camera>(camera);
  useEffect(() => {
    cameraRef.current = camera;
  });

  const handleResize = useCallback((size: Size): void => {
    setViewport((current) =>
      current.width === size.width && current.height === size.height ? current : size,
    );
  }, []);

  const input = { beginPan, panMove, endPan, wheel, gesture, zoomStep, reset };

  /** Add a note at a point of the board and start typing it straight away. */
  const createAt = useCallback(
    (world: Point): void => {
      if (!canEditRef.current) {
        return;
      }
      const id = createSticky(doc, world);
      if (id !== '') {
        startEdit(id);
      }
    },
    [doc, startEdit],
  );

  /** Start typing a note - the one thing a board that could not be loaded will not do. */
  const requestEdit = useCallback(
    (id: string): void => {
      if (!canEditRef.current) {
        return;
      }
      startEdit(id);
    },
    [startEdit],
  );

  /** Double-click on empty board space: a note appears under the pointer. */
  const handleEmptyDoubleClick = useCallback(
    (point: Point): void => {
      createAt(screenToWorld(cameraRef.current, point));
    },
    [createAt],
  );

  /** Toolbar button: a note appears in the middle of what the user is looking at. */
  const handleCreateSticky = useCallback((): void => {
    createAt(screenToWorld(cameraRef.current, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [createAt, viewport.height, viewport.width]);

  /** A click on empty board space deselects (editing has already ended by then). */
  const handleEmptyClick = useCallback((): void => {
    select(null);
  }, [select]);

  // Keyboard: Delete removes the selected note, Enter edits it. Both are ignored while
  // the user is typing, where those keys belong to the text.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isEditableTarget(event.target) || selectedId === null) {
        return;
      }
      if (event.key === 'Enter' || event.key === 'F2') {
        if (editingId === null && canEditRef.current) {
          event.preventDefault();
          startEdit(selectedId);
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingId !== null || !canEditRef.current) {
          return;
        }
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [doc, editingId, selectedId, select, startEdit]);

  return (
    <div className="app" data-testid="app">
      <BoardViewport
        camera={camera}
        viewport={viewport}
        input={input}
        onViewportResize={handleResize}
        onEmptyDoubleClick={handleEmptyDoubleClick}
        onEmptyClick={handleEmptyClick}
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
            onStartEdit={requestEdit}
            onEndEdit={endEdit}
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={handleCreateSticky} canEdit={editable} />
      <ConnectionStatus state={connection} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => {
          zoomStep('in');
        }}
        onZoomOut={() => {
          zoomStep('out');
        }}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
