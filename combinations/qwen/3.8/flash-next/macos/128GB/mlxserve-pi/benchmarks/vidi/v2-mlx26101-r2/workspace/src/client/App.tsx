import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import { Toolbar } from './board/Toolbar.js';
import { useBoardDoc } from './board/useBoardDoc.js';
import type { BoardConnector } from './board/useBoardDoc.js';
import { useSelection } from './board/useSelection.js';
import { BoardViewport } from './canvas/BoardViewport.js';
import { screenToWorld, viewportCentre } from './canvas/camera.js';
import { NavigationHint } from './canvas/NavigationHint.js';
import { ZoomControls } from './canvas/ZoomControls.js';
import {
  CameraProvider,
  useCamera,
  useCameraContextValue,
  useViewportSize,
} from './canvas/useCamera.js';
import { ConnectionStatus } from './sync/ConnectionStatus.js';
import { StickyNote } from './objects/StickyNote.js';
import { isValidBoardId, newBoardId } from '../shared/board-id.js';
import { createSticky, deleteObject } from '../shared/board-model.js';

/** Focus guard: a keyboard shortcut must not fire while the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const name = target.tagName;
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT' || target.isContentEditable;
}

/**
 * The address of a board: `/b/<boardId>`. The browser's own address bar is the
 * router here - there is no router dependency - because a board is a place you
 * go to, and the link to it is the thing people share. Story 5 adds the board
 * list on top of this; all it needs is `boardPath`.
 */
export const BOARD_PATH_PREFIX = '/b/';

/** The board this path names, or null when it names none (`/`, or rubbish). */
export function boardIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith(BOARD_PATH_PREFIX)) return null;
  const candidate = pathname.slice(BOARD_PATH_PREFIX.length).replace(/\/+$/u, '');
  return isValidBoardId(candidate) ? candidate : null;
}

/** The path a board lives at (design "connection-status": `/b/<boardId>`). */
export const boardPath = (boardId: string): string => `${BOARD_PATH_PREFIX}${boardId}`;

export interface AppProps {
  /** How to reach the room; tests pass a fake (see `connectBoard`). */
  connect?: BoardConnector;
}

/**
 * The route. `/b/<boardId>` opens that board; anything else - `/` on a fresh
 * visit, or a link that does not name a board - opens a board of its own and
 * puts its address in the bar, so there is something to share straight away.
 */
export function App({ connect }: AppProps = {}): JSX.Element {
  const [boardId, setBoardId] = useState<string | null>(() =>
    boardIdFromPathname(window.location.pathname),
  );

  useEffect(() => {
    if (boardId !== null) return;
    const fresh = newBoardId();
    // replaceState, not a navigation: this is the same page arriving at the
    // address it should have had, and it must not push a history entry.
    window.history.replaceState(null, '', boardPath(fresh));
    setBoardId(fresh);
  }, [boardId]);

  if (boardId === null) {
    // One frame at most: the effect above has already chosen a board.
    return <div className="app" data-testid="app" />;
  }
  return <Board key={boardId} boardId={boardId} connect={connect} />;
}

/**
 * Top-level layout: the board fills the window, the toolbar stands on its left
 * edge, the zoom controls sit in the bottom-right corner, the first-use hint at
 * the bottom centre and the connection badge at the top centre. The camera lives
 * here (one camera per visit, per device) and is shared with the board surface
 * through context; the board content lives in the `Y.Doc` that `useBoardDoc`
 * owns and shares with everyone else on this board.
 */
function Board({ boardId, connect }: { boardId: string; connect?: BoardConnector }): JSX.Element {
  const viewport = useViewportSize();
  const api = useCamera(viewport);
  const context = useCameraContextValue(api, viewport);

  // The Y.Doc is the one place board content is kept: every note with its
  // position, colour, text and stacking order. Selection and editing are
  // deliberately *not* in it: what this user has selected is not board content,
  // and once the document is shared (story 3) writing it there would move other
  // people's selection.
  const { doc, notes, connection } = useBoardDoc(boardId, connect);
  const { selectedId, editingId, select, startEdit, endEdit } = useSelection();

  /** Create a note centred on a world point, select it and open it for typing. */
  const createAt = useCallback(
    (x: number, y: number) => {
      const id = createSticky(doc, { x, y });
      if (typeof id !== 'string') return;
      select(id);
      startEdit(id);
    },
    [doc, select, startEdit],
  );

  /** The Sticky note button and the `N` shortcut: the middle of what is visible. */
  const createInMiddleOfView = useCallback(() => {
    const centre = viewportCentre(viewport);
    const world = screenToWorld(api.camera, centre);
    createAt(world.x, world.y);
  }, [api.camera, createAt, viewport]);

  /**
   * The notes in a stable order, which is *not* the drawing order: they are drawn
   * by their `z` (a CSS stacking order), while the DOM keeps one element per note
   * in the order they were made. Reordering the elements every time a note is
   * brought to the front would move a node that has the pointer captured, which
   * ends the drag in the middle of a gesture - and it would throw away React's
   * state for a note the user is typing into.
   */
  const stackOrder = useMemo(
    () =>
      [...notes].sort(
        (a, b) =>
          a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      ),
    [notes],
  );

  // A note that is no longer in the document cannot stay selected or open for
  // editing: clicking the bin - or a delete that arrives from elsewhere - clears
  // the local state that pointed at it, and nothing is re-created.
  useEffect(() => {
    const alive = new Set(notes.map((note) => note.id));
    if (editingId !== null && !alive.has(editingId)) {
      endEdit('unselected');
    } else if (selectedId !== null && !alive.has(selectedId)) {
      select(null);
    }
  }, [notes, editingId, selectedId, endEdit, select]);

  // The keyboard shortcuts belong to the board, not to a focused element, so
  // this listener is on `window` rather than on the canvas.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Never swallow a keystroke that belongs to a text field.
      if (isTypingTarget(event.target)) return;

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        createInMiddleOfView();
      } else if (event.key === 'Enter') {
        if (selectedId !== null && editingId === null) {
          event.preventDefault();
          startEdit(selectedId);
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedId !== null && editingId === null) {
          event.preventDefault();
          deleteObject(doc, selectedId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api.camera, createInMiddleOfView, doc, editingId, select, selectedId, startEdit]);

  return (
    <div className="app" data-testid="app">
      <CameraProvider value={context}>
        <Toolbar onCreateSticky={createInMiddleOfView} />
        <BoardViewport
          doc={doc}
          onStickyCreated={(id) => {
            select(id);
            startEdit(id);
          }}
          onEmptyClick={() => {
            // Clicking empty board space selects nothing. While a note is being
            // edited its own editor ends the editing (and clears the selection),
            // so the note the user is typing into is never lost by a stray click.
            if (editingId === null) select(null);
          }}
        >
          {stackOrder.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={doc}
              zoom={api.camera.zoom}
              selected={note.id === selectedId}
              editing={note.id === editingId}
              onSelect={select}
              onStartEdit={startEdit}
              onEndEdit={endEdit}
            />
          ))}
        </BoardViewport>
      </CameraProvider>
      <ZoomControls
        zoomPercent={context.zoomPercent}
        canZoomIn={context.canZoomIn}
        canZoomOut={context.canZoomOut}
        onZoomIn={() => api.zoomStep('in')}
        onZoomOut={() => api.zoomStep('out')}
        onReset={api.reset}
      />
      <NavigationHint visible={!api.hasNavigated} />
      <ConnectionStatus state={connection} />
    </div>
  );
}
