import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import { StickyNote } from './objects/StickyNote';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { useCamera, useElementSize } from './canvas/useCamera';
import { useTestCameraHook, useTestConnectionHook } from './canvas/testHooks';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent, type Point } from './canvas/camera';
import { ConnectionStatus } from './sync/ConnectionStatus';
import { newBoardId } from '../shared/board-id';
import { createSticky, deleteObject } from '../shared/board-model';

/** Focus in a text field means keys belong to that field, not to the board. */
function isField(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== 'string') return false;
  return (
    element.isContentEditable === true ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
  );
}

export interface AppProps {
  /** Board document to render. Defaults to a fresh local one (tests pass one). */
  doc?: Y.Doc;
  /** Board to join instead of the one in the address (tests). */
  boardId?: string;
}

/**
 * The board this tab is on: `/b/<boardId>`.
 *
 * Any other address — the root of the site in particular — becomes a new board:
 * a board id is generated and the address is rewritten without a reload. Story 5
 * replaces this with a board the server creates.
 */
function boardIdFromLocation(): string {
  const route = /^\/b\/([^/?#]+)/.exec(window.location.pathname);
  if (route !== null) return route[1];

  const id = newBoardId();
  window.history.replaceState({}, '', `/b/${id}`);
  return id;
}

/**
 * Top-level layout: the infinite board fills the window, the tools float
 * bottom-right, the first-use hint bottom-centre and the sticky note tool
 * bottom-left. All camera state lives in `useCamera`; the controls are
 * presentational.
 *
 * The board document comes from `useBoardDoc` and is read through its
 * `objects` map, so a note appears the moment it is created here or by someone
 * else. Selection and editing are local state (`useSelection`) and never reach
 * the shared document.
 */
export function App({ doc: providedDoc, boardId: providedBoardId }: AppProps = {}) {
  // Read once: the address of a mounted tab does not change under it, and a
  // generated board id must not be regenerated on every render.
  const [boardId] = useState(() => providedBoardId ?? boardIdFromLocation());
  const { doc, notes, connectionState } = useBoardDoc({ boardId, doc: providedDoc });
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewport = useElementSize(viewportRef);
  const controller = useCamera(viewport);
  const { camera } = controller;

  useTestCameraHook(controller);
  useTestConnectionHook(connectionState);

  /**
   * Puts a sticky note on the board at a viewport coordinate and opens it for
   * typing, leaving the board exactly where it was (`sticky.create_toolbar`,
   * `sticky.create_dbclick`, `sticky.create_centre`, `sticky.create_no_move`).
   */
  const createStickyAt = useCallback(
    (screenPoint: Point): void => {
      const world = screenToWorld(controller.getCamera(), screenPoint);
      const id = createSticky(doc, world);
      if (id === '') return;
      startEdit(id);
    },
    [controller, doc, startEdit],
  );

  /** The toolbar tool: middle of what is on screen. */
  const createStickyInCentre = useCallback((): void => {
    createStickyAt({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createStickyAt, viewport.height, viewport.width]);

  // A note that vanishes (someone else deleted it) must not stay selected, and
  // its editor must not stay open.
  useEffect(() => {
    if (selectedId === null) return;
    if (notes.some((note) => note.id === selectedId)) return;
    select(null);
  }, [notes, select, selectedId]);

  // Keyboard: Enter edits the selected note, Delete or Backspace removes it.
  // While a note is being typed in, keys belong to the note — its editor stops
  // them, and this listener stays out of the way.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingId !== null || isField(event.target)) return;
      if (event.key === 'Enter') {
        if (selectedId === null) return;
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (selectedId === null) return;
      event.preventDefault();
      deleteObject(doc, selectedId);
      select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doc, editingId, select, selectedId, startEdit]);

  const dropSelection = useCallback((): void => {
    select(null);
  }, [select]);

  return (
    <div className="app" data-testid="app">
      <BoardViewport
        camera={camera}
        controls={controller}
        rootRef={viewportRef}
        onEmptyPointerDown={dropSelection}
        onEmptyDoubleClick={createStickyAt}
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
          />
        ))}
      </BoardViewport>
      <Toolbar onCreateSticky={createStickyInCentre} />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
      <NavigationHint visible={!controller.hasNavigated} />
      <ConnectionStatus state={connectionState} />
    </div>
  );
}
