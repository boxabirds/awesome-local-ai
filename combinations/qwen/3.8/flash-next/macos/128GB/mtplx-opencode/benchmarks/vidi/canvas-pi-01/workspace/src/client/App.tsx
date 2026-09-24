/**
 * Story 1 · top-level layout.
 *
 * The camera lives in `useCamera`, created here with the measured size of the
 * board area, shared through `CameraApiContext`, and wired to the three
 * presentational pieces: the input surface, the zoom control and the hint.
 *
 * Story 2 adds the document model and the sticky notes on top of that
 * navigation surface: `useBoardDoc` owns the Y.Doc, `useSelection` the local
 * selection / editing state, and the two toolbars. Notes are rendered inside
 * the world layer; create-by-double-click, create-by-button, keyboard editing
 * and keyboard delete are wired here.
 *
 * Story 3 adds routing + live collaboration. `/` redirects to a freshly minted
 * `/b/<boardId>` (temporary, replaced by real navigation in story 5); `/b/:id`
 * renders the board and attaches the `WebsocketProvider` for that room. A board
 * change remounts the shell (via `key`) so one board's document, provider and
 * selection never leak into another (PRD live.isolation). The connection badge
 * is the only new chrome.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import type { Size } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { CameraApiContext, useCamera, useViewportSize } from './canvas/useCamera';
import { Toolbar } from './board/Toolbar';
import { useBoardDoc } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { ConnectionStatus } from './sync/ConnectionStatus';
import type { ConnectionState } from './sync/connectionState';
import { useLiveTestHooks } from './sync/testHooks';
import { createSticky, deleteObject } from '../shared/board-model';
import { isBoardId, newBoardId } from '../shared/board-id';

/**
 * Is the board editable right now? False only for `load_failed` (story 4):
 * while the room cannot read the board, everything typed here would be a
 * second, unrelated version of it. Every other state — including a storage
 * failure, where the board is readable and unsaved changes are re-sent — keeps
 * the canvas live.
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== 'load_failed';
}

/**
 * The board, given the size of the area it occupies. Split out from `App` so
 * component tests can render the real tree with a fixed viewport size (and a
 * pre-seeded document). With no `boardId` there is no network provider — the
 * board runs purely locally, which is what those tests want.
 */
export function BoardShell({
  viewport,
  doc,
  boardId,
  connectionState: connectionOverride,
}: {
  viewport: Size;
  doc?: Y.Doc;
  boardId?: string;
  /**
   * Component tests drive the five connection states without a server by
   * supplying the state directly; production leaves it undefined and follows
   * the live provider.
   */
  connectionState?: ConnectionState;
}) {
  const api = useCamera(viewport);
  const camera = api.camera;
  const { doc: boardDoc, notes, connectionState: liveState } = useBoardDoc(doc, boardId);
  const connectionState = connectionOverride ?? liveState;
  const selection = useSelection(boardDoc);

  // The single editing switch (design `persist.client_status`): a board that
  // could not be loaded is read-only until a sync succeeds.
  const editable = canEdit(connectionState);

  useLiveTestHooks(boardDoc, connectionState);

  // Refs so the window keydown listener always reads the latest state without
  // being re-bound on every render.
  const selectedRef = useRef(selection.selectedId);
  const editingRef = useRef(selection.editingId);
  const editableRef = useRef(editable);
  selectedRef.current = selection.selectedId;
  editingRef.current = selection.editingId;
  editableRef.current = editable;

  const createAtWorld = useCallback(
    (world: { x: number; y: number }) => {
      if (!editableRef.current) return;
      const id = createSticky(boardDoc, world);
      selection.startEdit(id);
    },
    [boardDoc, selection],
  );

  const createAtCentre = useCallback(() => {
    const centre = screenToWorld(camera, { x: viewport.width / 2, y: viewport.height / 2 });
    createAtWorld(centre);
  }, [camera, viewport.width, viewport.height, createAtWorld]);

  const onEmptyClick = useCallback(() => {
    if (selection.editingId !== null) selection.endEdit('unselected');
    else selection.select(null);
  }, [selection]);

  const onDeleteNote = useCallback(
    (id: string) => {
      if (!editableRef.current) return;
      deleteObject(boardDoc, id);
      selection.select(null);
    },
    [boardDoc, selection],
  );

  // Keyboard: Enter starts editing the selected note; Delete/Backspace delete
  // it — but only when we are not editing text (then they edit characters).
  useEffect(() => {
    const isTypingTarget = (node: EventTarget | null): boolean => {
      const el = node as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return; // zoom shortcuts
      if (isTypingTarget(event.target)) return; // keys belong to the editor
      // A read-only board answers no editing keys either (only the ones that
      // would change the doc: Enter and Delete stay with the board).
      if (!editableRef.current) return;

      if (event.key === 'Enter') {
        if (editingRef.current !== null) return;
        const id = selectedRef.current;
        if (id) {
          event.preventDefault();
          selection.startEdit(id);
        }
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editingRef.current !== null) return;
        const id = selectedRef.current;
        if (id) {
          event.preventDefault();
          onDeleteNote(id);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection, onDeleteNote]);

  return (
    <CameraApiContext.Provider value={api}>
      <div className="board-root" data-testid="board-root">
        <BoardViewport onEmptyClick={onEmptyClick} onEmptyDoubleClick={createAtWorld}>
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={boardDoc}
              zoom={camera.zoom}
              editable={editable}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={(id) => selection.select(id)}
              onStartEdit={(id) => selection.startEdit(id)}
              onEndEdit={(next) => selection.endEdit(next)}
              onDelete={onDeleteNote}
            />
          ))}
        </BoardViewport>
        <Toolbar onCreateSticky={createAtCentre} disabled={!editable} />
        <ZoomControls
          zoomPercent={zoomPercent(camera)}
          canZoomIn={canZoomIn(camera)}
          canZoomOut={canZoomOut(camera)}
          onZoomIn={() => api.zoomStep('in')}
          onZoomOut={() => api.zoomStep('out')}
          onReset={() => api.reset()}
        />
        <NavigationHint visible={!api.hasNavigated} />
        {boardId !== undefined && <ConnectionStatus state={connectionState} />}
      </div>
    </CameraApiContext.Provider>
  );
}

/** Parse a board id out of a path like `/b/<id>`; `null` if none. */
function boardIdFromPath(pathname: string): string | null {
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match === null) return null;
  const candidate = decodeURIComponent(match[1] as string);
  return isBoardId(candidate) ? candidate : null;
}

function currentPathname(): string {
  return typeof window !== 'undefined' && window.location
    ? window.location.pathname
    : '/';
}

/**
 * A minimal board router. React Router is not a dependency yet, and this story
 * needs only one fact from the URL — which board — so a pathname hook is
 * enough: `/` (and any non-board path) mints a fresh board id and rewrites the
 * address, `/b/:id` is read back. The id is computed once per mount (not per
 * render) so the board is stable, and the returned `key` remounts the shell on
 * a board change so one board's document, provider and selection never leak
 * into another (PRD live.isolation).
 */
function useBoardRoute(): string {
  const initialPath = currentPathname();
  const [boardId, setBoardId] = useState<string>(
    () => boardIdFromPath(initialPath) ?? newBoardId(),
  );

  useEffect(() => {
    // Adopt a fresh address only when the current path is not already a valid
    // board (`/`, or a hand-edited board id that failed validation).
    if (boardIdFromPath(currentPathname()) === null) {
      window.history.replaceState(null, '', `/b/${boardId}`);
    }
    const onPop = () => {
      const next = boardIdFromPath(currentPathname());
      if (next !== null) setBoardId(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [boardId]);

  return boardId;
}

export function App() {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewport = useViewportSize(stageRef);
  const boardId = useBoardRoute();

  return (
    <div ref={stageRef} className="board-root" data-testid="board-stage">
      {/* `key` remounts per board: a fresh document, provider and selection. */}
      <BoardShell key={boardId} viewport={viewport} boardId={boardId} />
    </div>
  );
}