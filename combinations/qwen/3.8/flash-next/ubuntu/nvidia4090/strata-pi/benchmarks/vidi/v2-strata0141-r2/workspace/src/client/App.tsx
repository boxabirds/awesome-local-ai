import {
  type JSX,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point, type Size } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installTestHooks } from './canvas/testHooks';
import { BoardControllerContext, useCamera, useViewportSize } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { isValidBoardId, newBoardId } from '../shared/board-id';

export interface AppProps {
  /** Use an existing document (component tests; no connection is attached). */
  doc?: Y.Doc;
  /** Override the measured board area (component tests run without layout). */
  viewportSize?: Size;
  /** Board to connect to. Defaults to the `/b/:boardId` in the address. */
  boardId?: string;
}

/** Keys must reach a focused input or textarea instead of the board shortcuts. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/**
 * The board this page is for, from the address: `/b/:boardId`.
 *
 * `/` opens a new board (temporary until story 5 creates boards on the server),
 * and an address that is not a board id becomes a new board rather than a page
 * that looks fine but saves nothing.
 */
export function resolveBoardId(): string | null {
  const pathname = window.location.pathname;
  const match = /^\/b\/([^/?#]+)/.exec(pathname);
  if (match?.[1] !== undefined) {
    const fromPath = decodeURIComponent(match[1]);
    if (isValidBoardId(fromPath)) {
      return fromPath;
    }
  } else if (pathname !== '/' && pathname !== '/index.html') {
    // Some other path: a local board, no connection (this is how component
    // tests render the app without a server).
    return null;
  }
  const id = newBoardId();
  window.history.replaceState(null, '', `/b/${id}`);
  return id;
}

export default function App({ doc: providedDoc, viewportSize, boardId: boardIdProp }: AppProps = {}): JSX.Element {
  const boardRef = useRef<HTMLDivElement | null>(null);
  const measured = useViewportSize(boardRef);
  const viewport = viewportSize ?? measured;
  const controller = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // A supplied document belongs to its caller (tests): no room connection.
  const boardId = providedDoc !== undefined ? undefined : (boardIdProp ?? resolveBoardId() ?? undefined);
  const { doc, notes, connectionState } = useBoardDoc(providedDoc, { boardId });
  const selection = useSelection();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const docRef = useRef(doc);
  docRef.current = doc;

  // Someone else may delete the note this page has selected or is typing in.
  // Selection is local, so only this page notices, and it notices immediately.
  useEffect(() => {
    const present = new Set(notes.map((note) => note.id));
    const active = selectionRef.current;
    if (active.editingId !== null && !present.has(active.editingId)) {
      active.endEdit('unselected');
    } else if (active.selectedId !== null && !present.has(active.selectedId)) {
      active.select(null);
    }
  }, [notes]);

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      installTestHooks(controllerRef);
    }
  }, []);

  /** Create a note centred on a world point and start typing in it. */
  const createAt = useCallback((world: Point): void => {
    const id = createSticky(docRef.current, world);
    if (id !== null) {
      selectionRef.current.startEdit(id);
    }
  }, []);

  /** Toolbar creation: the middle of the visible board area, wherever it is. */
  const createAtViewportCentre = useCallback((): void => {
    const camera = controllerRef.current.camera;
    const size = viewportRef.current;
    createAt(screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }));
  }, [createAt]);

  const clearSelection = useCallback((): void => {
    selectionRef.current.select(null);
  }, []);

  // Board-level keys: Enter edits the selected note, Delete/Backspace removes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const active = selectionRef.current;
      // While typing, Delete and Backspace edit characters in the note.
      if (active.editingId !== null || isTypingTarget(event.target)) {
        return;
      }
      if (active.selectedId === null) {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        active.startEdit(active.selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(docRef.current, active.selectedId);
        active.select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const { camera } = controller;

  return (
    <div className="board-root" ref={boardRef} data-testid="board-root">
      <BoardControllerContext.Provider value={controller}>
        <BoardViewport onCreateAt={createAt} onEmptyClick={clearSelection}>
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selection.select}
              onStartEdit={selection.startEdit}
              onEndEdit={selection.endEdit}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={createAtViewportCentre} />
        <ConnectionStatus state={connectionState} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => controller.zoomStep('in')}
          onZoomOut={() => controller.zoomStep('out')}
          onReset={controller.reset}
        />
        <NavigationHint visible={!controller.hasNavigated} />
      </BoardControllerContext.Provider>
    </div>
  );
}
