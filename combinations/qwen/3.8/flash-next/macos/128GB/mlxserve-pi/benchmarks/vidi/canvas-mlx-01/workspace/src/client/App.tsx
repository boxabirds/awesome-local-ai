import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { BoardViewport } from './canvas/BoardViewport.js';
import { NavigationHint } from './canvas/NavigationHint.js';
import { ZoomControls } from './canvas/ZoomControls.js';
import { useCamera } from './canvas/useCamera.js';
import { screenToWorld, type Size } from './canvas/camera.js';
import { useBoardDoc } from './board/useBoardDoc.js';
import { ConnectionStatus } from './board/ConnectionStatus.js';
import type { ConnectionStatus as ConnectionState } from './board/connectBoard.js';
import { useSelection } from './board/useSelection.js';
import { Toolbar } from './board/Toolbar.js';
import { StickyNote } from './objects/StickyNote.js';
import { createSticky, deleteObject } from '../shared/board-model.js';
import { newBoardId } from '../shared/board-id.js';
import { MAX_CONCURRENT_EDITORS } from '../shared/config.js';
import { registerBoardTestHooks } from './canvas/testHooks.js';

/** True when focus is in a text field, so board keyboard shortcuts stand down. */
const focusIsEditable = (): boolean => {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
};

/** Whether the board may be edited for a given connection status. Only a board the room
 *  refused to LOAD is un-editable; every other state (connecting/online/reconnecting, and
 *  the create flow's null) edits normally. A repaired board re-enables on first sync. */
export function canEdit(status: ConnectionState | null): boolean {
  return status !== 'load_failed';
}

/** Parse a path into a board id, or undefined for the create flow / an invalid id. */
function parseBoardId(pathname: string): { boardId?: string; invalid: boolean } {
  const match = /^\/b\/([^/?#]+)/.exec(pathname);
  if (!match) return { invalid: false };
  const candidate = decodeURIComponent(match[1]!);
  return candidate.length === BOARD_ID_LENGTH && BOARD_ID_CHARS.test(candidate)
    ? { boardId: candidate, invalid: false }
    : { invalid: true };
}

const BOARD_ID_LENGTH = 22;
const BOARD_ID_CHARS = /^[A-Za-z0-9_-]+$/;

/**
 * Top-level layout: the infinite board with its sticky notes, the left toolbar that
 * creates notes, the zoom control and the first-use hint. Notes live in a `Y.Doc`
 * created once per page (nothing is persisted in this story; a reload starts empty).
 */
export function App(): JSX.Element {
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const camera = useCamera(viewport);

  // Routing: `/` is the create flow (no connection), `/b/:boardId` is a live board.
  const [path, setPath] = useState<string>(() =>
    typeof window === 'undefined' ? '/' : window.location.pathname,
  );
  useEffect(() => {
    const onPop = (): void => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((next: string): void => {
    if (window.location.pathname !== next) window.history.pushState({}, '', next);
    setPath(next);
  }, []);
  const route = parseBoardId(path);

  const { doc, notes, connectionStatus, peerCount } = useBoardDoc({ boardId: route.boardId });
  const selection = useSelection();
  const { select, startEdit, endEdit } = selection;
  const zoom = camera.camera.zoom;

  // Paint notes in a stable creation order and stack them with CSS `z-index` (see
  // StickyNote). Re-ordering the DOM on `bringToFront` would re-insert the node the
  // pointer is captured on, fire `lostpointercapture` and cancel an in-flight drag.
  const stacked = useMemo(
    () => [...notes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [notes],
  );
  const onViewportSize = useCallback((size: Size): void => {
    setViewport(size);
  }, []);

  /** Create a note whose centre lands on a viewport-relative screen point. */
  const createAtScreen = useCallback(
    (screenPoint: { x: number; y: number }): void => {
      if (!canEdit(connectionStatus)) return; // a board that couldn't be loaded is not editable
      const world = screenToWorld(camera.camera, screenPoint);
      const id = createSticky(doc, world);
      if (id) startEdit(id);
    },
    [camera.camera, doc, startEdit, connectionStatus],
  );

  /** The toolbar button creates a note in the middle of the visible board area. */
  const createAtCentre = useCallback((): void => {
    createAtScreen({ x: viewport.width / 2, y: viewport.height / 2 });
  }, [createAtScreen, viewport.width, viewport.height]);

  /** The create flow starts a live board at a fresh board id and routes to it. */
  const startBoard = useCallback((): void => {
    go(`/b/${newBoardId()}`);
  }, [go]);

  // Board-level keyboard: Enter edits the selected note; Delete/Backspace removes it.
  // Both stand down while a note is being edited (then those keys belong to the textarea).
  const { selectedId, editingId } = selection;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (editingId !== null) return; // editing text owns the keys
      if (focusIsEditable()) return;
      if (selectedId === null) return;

      if (event.key === 'Enter') {
        if (!canEdit(connectionStatus)) return; // a read-only board never opens the editor
        event.preventDefault();
        startEdit(selectedId);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!canEdit(connectionStatus)) return; // refuse to delete on an un-loadable board
        event.preventDefault();
        deleteObject(doc, selectedId);
        select(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, editingId, doc, select, startEdit, connectionStatus]);

  // Expose the real doc and selection to the component / e2e suites (test builds only).
  useEffect(() => {
    registerBoardTestHooks(
      () => doc,
      () => ({ selectedId, editingId }),
    );
  }, [doc, selectedId, editingId]);

  return (
    <>
      <BoardViewport
        api={camera}
        onViewportSize={onViewportSize}
        onCreateAtPoint={createAtScreen}
        onClearSelection={() => {
          select(null);
        }}
      >
        {stacked.map((note) => (
          <StickyNote
            key={note.id}
            note={note}
            doc={doc}
            zoom={zoom}
            selected={selection.selectedId === note.id}
            editing={selection.editingId === note.id}
            onSelect={select}
            onStartEdit={startEdit}
            onEndEdit={endEdit}
            editable={canEdit(connectionStatus)}
          />
        ))}
      </BoardViewport>

      <Toolbar onCreateSticky={createAtCentre} disabled={!canEdit(connectionStatus)} />

      {/* Live connection badge: online/connecting once connected, offline only for a bad
          board id (TC-20). The create flow renders neither — there is no socket. */}
      {route.invalid ? (
        <ConnectionStatus status="offline" message="This board link is not valid." />
      ) : connectionStatus !== null ? (
        <ConnectionStatus status={connectionStatus} peers={peerCount ?? undefined} />
      ) : null}

      {/* Advisory over-capacity note. The limit is soft: a joiner is never refused, it
          only sees this notice once there are at least MAX_CONCURRENT_EDITORS other
          editors present (i.e. the board is over its advisory limit). Editing continues. */}
      {peerCount !== null && peerCount >= MAX_CONCURRENT_EDITORS ? (
        <span className="vidi-soft-capacity test-soft-capacity" data-peer-count={peerCount}>
          {`Heads up — ${peerCount} other editors are on this board. You can keep editing.`}
        </span>
      ) : null}

      {/* Create-flow affordance: begin a live board and route to its `/b/:id`. */}
      {!route.boardId && !route.invalid ? (
        <button type="button" data-testid="create-board" className="vidi-create-board" onClick={startBoard}>
          Start a board
        </button>
      ) : null}

      <ZoomControls
        zoomPercent={camera.zoomPercent}
        canZoomIn={camera.canZoomIn}
        canZoomOut={camera.canZoomOut}
        onZoomIn={() => {
          camera.zoomStep('in');
        }}
        onZoomOut={() => {
          camera.zoomStep('out');
        }}
        onReset={camera.reset}
      />
      <NavigationHint visible={!camera.hasNavigated} />
    </>
  );
}
