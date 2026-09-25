import { useCallback, useEffect, useRef } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, zoomPercent } from './canvas/camera';
import type { Camera, Point } from './canvas/camera';
import { BoardViewport } from './canvas/BoardViewport';
import { CameraContext, useCamera, useViewportSize } from './canvas/useCamera';
import { NavigationHint } from './canvas/NavigationHint';
import { ZoomControls } from './canvas/ZoomControls';
import { installBoardTestHooks, removeBoardTestHooks } from './canvas/testHooks';
import { Toolbar } from './board/Toolbar';
import { useBoardSnapshot } from './board/useBoardDoc';
import { useSelection } from './board/useSelection';
import { StickyNote } from './objects/StickyNote';
import { createSticky, deleteObject } from '../shared/board-model';
import { isValidBoardId, parseBoardPath } from '../shared/board-id';
import { STICKY_SIZE_WORLD } from '../shared/config';
import { useBoardSession, type BoardSession } from './sync/boardSession';
import { ConnectionStatus, useConnectionState } from './sync/ConnectionStatus';
import { PresenceIdentity, PresenceStack, RemoteCursors, RemoteSelections } from './presence/Presence';
import { toScreenPeople, usePresence } from './presence/usePresence';
import type { Person } from './presence/people';
import type { ProviderLike } from './sync/connectBoard';
import * as Y from 'yjs';

/** Tags that own their own keyboard input, so the board must not steal it. */
const INPUT_TAGS = new Set(['input', 'textarea', 'select']);

/** The prefix that marks a path as "someone is trying to open a board link". */
const BOARD_PATH_PREFIX = '/board/';

/**
 * True when the keystroke belongs to a text field. Both halves of the rule are
 * needed: `editingId` catches the note's own textarea, and the tag check
 * catches any other input (a future comment box, the browser's find bar) so a
 * Delete there never deletes a note.
 */
function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return INPUT_TAGS.has(target.tagName.toLowerCase()) || target.isContentEditable;
}

/**
 * Should this path be called out?
 *
 * Only a path that *looks like* a board link but is not one. `/` is the normal
 * way to arrive, and warning there would be noise; `/board/0123456789abcde`
 * (one character short) is a link that got truncated in Slack, and saying
 * nothing is how people end up editing the wrong board.
 */
export function isBrokenBoardLink(path: string): boolean {
  if (!path.startsWith(BOARD_PATH_PREFIX)) return false;
  const last = path.split('/').filter((segment) => segment.length > 0).pop() ?? '';
  return !isValidBoardId(last);
}

export interface AppProps {
  /** The path to render. Defaults to the browser's own location. */
  location?: string;
  /** A document to render instead of the session's own (tests, story 4). */
  doc?: Y.Doc;
  /** How to build the connection. Component tests pass a fake provider. */
  providerFactory?: (url: string, room: string, doc: Y.Doc) => ProviderLike;
  /** Socket origin. Defaults to the page's own host. */
  origin?: string;
}

/** The board's own document, with whatever is attached to it. */
function useSessionFor(props: AppProps): BoardSession {
  const path =
    props.location ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  return useBoardSession(parseBoardPath(path), {
    doc: props.doc,
    providerFactory: props.providerFactory,
    // No origin here on purpose: in a browser the room lives on the page's own
    // host, and hard-coding one would send a deployed client to localhost.
    origin: props.origin,
  });
}

/**
 * Top-level layout: a full-window board area, the sticky tools on the left,
 * the zoom controls bottom-right, the connection badge top-right and the
 * first-use hint near the bottom centre.
 *
 * The one piece of shared state is the session, and the whole board is keyed
 * by it: a new board means a new document, so the selection and the camera are
 * rebuilt rather than carried over. What you would see if you opened someone
 * else's board is their board from their last change, not your last view.
 */
export function App(props: AppProps = {}) {
  const session = useSessionFor(props);
  const path =
    props.location ?? (typeof window === 'undefined' ? '/' : window.location.pathname);
  const broken = isBrokenBoardLink(path);

  return (
    <BoardSurface
      // The key is the board, not the component: switching rooms must not be
      // able to reuse the old room's selection or camera.
      key={`${session.boardId}:${session.url ?? 'local'}`}
      session={session}
      broken={broken}
    />
  );
}

function BoardSurface({
  session,
  broken,
}: {
  session: BoardSession;
  broken: boolean;
}) {
  const boardAreaRef = useRef<HTMLDivElement | null>(null);
  const viewport = useViewportSize(boardAreaRef);
  const cameraApi = useCamera(viewport);
  const board = session.board;
  const notes = useBoardSnapshot(board);
  const selection = useSelection();
  const connectionState = useConnectionState(session.connection);

  // Listeners that are bound once read the live stores through these refs.
  const boardRef = useRef(board);
  boardRef.current = board;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const cameraRef = useRef<{ camera: Camera }>(cameraApi);
  cameraRef.current = cameraApi;

  // Who else is on this board, and the channel that says so. Read through a
  // ref below because the pointer listener is bound once per board.
  const presence = usePresence(session, cameraRef);
  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  const apiRef = useRef(cameraApi);
  useEffect(() => {
    apiRef.current = cameraApi;
  });

  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    installBoardTestHooks(
      () => apiRef.current,
      () => sessionRef.current,
    );
    return () => removeBoardTestHooks();
  }, []);

  // My pointer, published. The listener is on the board area rather than the
  // window so a move over the toolbar or the zoom control is not reported as a
  // point at nothing, and the position handed over is relative to the area the
  // overlay draws into.
  useEffect(() => {
    const area = boardAreaRef.current;
    if (area === null) return;
    const onPointerMove = (event: PointerEvent): void => {
      const rect = area.getBoundingClientRect();
      presenceRef.current.publish({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    };
    area.addEventListener('pointermove', onPointerMove);

    // And the two ways a pointer stops meaning anything: it left the board, or
    // the whole tab went to the background. Both say "I am not here right now",
    // and an arrow that keeps pointing at a note I stopped looking at is a wrong
    // answer about where I am, told for another two seconds.
    const onPointerLeave = (): void => {
      presenceRef.current.hide();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') presenceRef.current.hide();
    };
    area.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      area.removeEventListener('pointermove', onPointerMove);
      area.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /** Put a sticky at a world point and start typing straight away. */
  const createStickyAt = useCallback(
    (point: Point) => {
      const id = createSticky(boardRef.current.doc, point);
      if (!id) return;
      selection.startEdit(id);
    },
    [selection],
  );

  /** The toolbar button: a note in the middle of what I can see right now. */
  const createStickyInViewCentre = useCallback(() => {
    const camera = cameraRef.current.camera;
    const size = viewportRef.current;
    createStickyAt(
      screenToWorld(camera, { x: size.width / 2, y: size.height / 2 }),
    );
  }, [createStickyAt]);

  const notesRef = useRef(notes);
  notesRef.current = notes;

  /** The board's own key handling, shared by mouse and keyboard users. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextInput(event.target)) return;
      const state = selection.current();
      // While a note is being edited every key belongs to the textarea.
      if (state.editingId !== null) return;
      const id = state.selectedId;
      if (id === null) return;

      if (event.key === 'Enter') {
        // A selected or Tab-focused note: start editing it.
        event.preventDefault();
        selection.startEdit(id);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteObject(boardRef.current.doc, id);
        // Also true for a note that is already gone: the stale selection goes
        // away either way.
        selection.select(null);
      }
    };

    // The one window listener of the story: the board, not the note, owns the
    // keyboard, so a note does not have to be focused for Delete to work.
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection]);

  const camera = cameraApi.camera;

  /**
   * Everyone the stack shows, this browser included.
   *
   * `presence.board` rather than `presence.people`: the names and colours a
   * person is *called* are settled by a pass over the whole board, and the
   * stack is one of the two places people read them. Handing it the raw list
   * would draw two people in one colour and let a tab whose own name is taken
   * keep wearing it, which is the exact thing five people opening a shared link
   * produce. The person looking at the board is part of the board.
   *
   * Nobody is hidden for being still. The stack answers "who is on this board",
   * and a person who is reading rather than clicking is on the board: awareness
   * drops them when their connection does, which is the honest answer, while a
   * thirty-second timer would quietly delete a quiet reader and call it a
   * departure. Cursors fade, because a place somebody looked at two seconds ago
   * is a claim about where they are; a dot makes no such claim.
   */
  const stackPeople: readonly Person[] = presence.board;

  const handleSurfaceClick = useCallback(() => {
    // Clicking empty board space drops the selection and any open editor.
    selection.select(null);
  }, [selection]);

  // What this screen has picked up, said out loud.
  useEffect(() => {
    // One line, one channel: the other four have to see that a note is being
    // typed in at the same moment it happens here, and an outline left over from
    // a note I have already dropped is worse than no outline.
    presenceRef.current.setSelection(selection.selectedId);
  }, [selection.selectedId]);

  const handleSurfaceDoubleClick = useCallback(
    (point: Point) => {
      createStickyAt(point);
    },
    [createStickyAt],
  );

  const selectNote = useCallback(
    (id: string | null) => {
      // A note that vanished mid-drag must not stay "selected": that would
      // leave the keyboard holding a stale id.
      if (id !== null && !notesRef.current.some((note) => note.id === id)) return;
      selection.select(id);
    },
    [selection],
  );

  const startEditNote = useCallback(
    (id: string) => {
      selection.startEdit(id);
    },
    [selection],
  );

  const endEditNote = useCallback(
    (next: 'selected' | 'unselected') => {
      selection.endEdit(next);
    },
    [selection],
  );

  const deleteNote = useCallback(
    (id: string) => {
      deleteObject(boardRef.current.doc, id);
      selection.select(null);
    },
    [selection],
  );

  return (
    <CameraContext.Provider value={cameraApi}>
      <div className="board-area" data-testid="board-area" ref={boardAreaRef}>
        <BoardViewport
          onSurfaceClick={handleSurfaceClick}
          onSurfaceDoubleClick={handleSurfaceDoubleClick}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={board.doc}
              zoom={camera.zoom}
              selected={selection.selectedId === note.id}
              editing={selection.editingId === note.id}
              onSelect={selectNote}
              onStartEdit={startEditNote}
              onEndEdit={endEditNote}
              onDelete={deleteNote}
            />
          ))}
        </BoardViewport>
        {/* Who is holding what, drawn under the cursors and above the notes: an
            outline is a notice, not a lock, so it never intercepts a click. */}
        <RemoteSelections
          people={presence.selections}
          objects={notes}
          camera={camera}
          size={STICKY_SIZE_WORLD}
        />
        {/* The resolved board, minus this screen's own pointer: what a cursor is
            *called* has to be what the stack calls the same person. */}
        <RemoteCursors
          people={toScreenPeople(presence.cursors, camera)}
          now={presence.now}
          viewport={viewport}
        />
        <div className="presence-area" data-testid="presence-area">
          <PresenceStack people={stackPeople} now={presence.now} selfId={presence.selfId} />
          <PresenceIdentity
            name={presence.self.name}
            onRename={(raw) => presenceRef.current.rename(raw)}
          />
        </div>
        <Toolbar onCreateSticky={createStickyInViewCentre} />
        <div className="connection-area">
          {broken ? (
            <p className="board-link-warning" data-testid="board-link-warning" role="status">
              That link is not a board, so this board is yours alone. Copy the
              address bar to share <em>this</em> board.
            </p>
          ) : null}
          <ConnectionStatus state={connectionState} />
        </div>
      </div>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => cameraApi.zoomStep('in')}
        onZoomOut={() => cameraApi.zoomStep('out')}
        onReset={() => cameraApi.reset()}
      />
      <NavigationHint visible={!cameraApi.hasNavigated} />
    </CameraContext.Provider>
  );
}
