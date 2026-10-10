import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { BoardViewport } from "./canvas/BoardViewport";
import { CameraProvider, useBoard } from "./canvas/CameraProvider";
import {
  canZoomIn,
  canZoomOut,
  screenToWorld,
  zoomPercent,
} from "./canvas/camera";
import { NavigationHint } from "./canvas/NavigationHint";
import { publishConnection, publishConnectionState } from "./canvas/testHooks";
import { seedBoard, type SeedNote } from "./testSeed";
import { ZoomControls } from "./canvas/ZoomControls";
import { useBoardDoc } from "./board/useBoardDoc";
import { useSelection } from "./board/useSelection";
import { Toolbar } from "./board/Toolbar";
import { ConnectionStatus } from "./sync/ConnectionStatus";
import type { ConnectionState } from "./sync/connectBoard";
import { createSticky, deleteObject } from "../shared/board-model";
import { isValidBoardId, newBoardId } from "../shared/board-id";
import type { Point } from "./canvas/camera";
import { StickyNote } from "./objects/StickyNote";

/** Zoom chrome wired to the board camera. */
function BoardZoomControls(): JSX.Element {
  const board = useBoard();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(board.camera)}
      canZoomIn={canZoomIn(board.camera)}
      canZoomOut={canZoomOut(board.camera)}
      onZoomIn={() => board.zoomStep("in")}
      onZoomOut={() => board.zoomStep("out")}
      onReset={board.reset}
    />
  );
}

/** First-use hint, hidden by the first pan or zoom of the visit. */
function BoardNavigationHint(): JSX.Element | null {
  const { hasNavigated } = useBoard();
  return <NavigationHint visible={!hasNavigated} />;
}

declare global {
  interface Window {
    /**
     * Test-only: mutate the board document as another client would.
     * `seed` is story 4's addition — a browser test that has to come back to a
     * board of a known size makes it here, through the real board model (see
     * `testSeed.ts`), so the notes it counts later left this client as real
     * Yjs updates and went through the room like any other change.
     */
    __vidi6Board?: {
      deleteNote(id: string): boolean;
      seed(notes: SeedNote[]): string[];
    };
  }
}

/**
 * Whether this client may write to the board right now: false for exactly one
 * connection state, `load_failed`, where the room reached the board's storage
 * and could not read the board out of it. What is on screen in that state is not
 * the board, it is nothing, and a person who types into nothing has written a
 * board nobody asked for (persist.load_failure). Every other state — even the
 * room failing to *save* this client's changes — is a board worth working on,
 * and the changes go out again with the next handshake (persist.save_failure).
 */
export function canEdit(state: ConnectionState): boolean {
  return state !== "load_failed";
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export interface BoardContentsProps {
  /** Board to sync with (`/api/rooms/<boardId>`); `null` stays offline. */
  boardId?: string | null;
  /** Use an existing document instead of owning one (component tests). */
  doc?: import("yjs").Doc;
}

/**
 * Everything inside the camera context: the board document, the local
 * selection, the notes inside the viewport and the window keyboard wiring
 * (Enter starts editing, Delete/Backspace delete the selected note — never
 * while its text is being edited).
 */
export function BoardContents({
  boardId = null,
  doc,
}: BoardContentsProps = {}): JSX.Element {
  const board = useBoard();
  const {
    doc: document,
    notes,
    connection,
    live,
  } = useBoardDoc(boardId, { doc });
  const { selectedId, editingId, select, startEdit, endEdit } =
    useSelection(document);
  /** Every way this client can change the board, decided in one place. */
  const editable = canEdit(connection);

  /** Start editing, if this board may be edited at all (TC-23). */
  const startEditing = useCallback(
    (id: string): void => {
      if (!editable) return;
      startEdit(id);
    },
    [editable, startEdit],
  );

  /** Create a note centred on a world point, selected and in edit mode. */
  const createAndEdit = useCallback(
    (world: Point): void => {
      // Double-click on empty board, and the Sticky note button: both create
      // nothing while the board could not be loaded (TC-23).
      if (!editable) return;
      const id = createSticky(document, world);
      if (typeof id !== "string") return; // non-finite point: nothing happens
      select(id);
      startEditing(id);
    },
    [document, editable, select, startEditing],
  );

  // A board that stops being editable also stops being *edited*: a note that was
  // open for typing closes, so the keystrokes that come after the bad news have
  // nowhere to go.
  useEffect(() => {
    if (!editable && editingId !== null) endEdit("selected");
  }, [editable, editingId, endEdit]);

  // Test-only hook, dropped from production builds: lets e2e tests delete a
  // note behind the client's back, as a collaborator would (stale
  // interactions, TC-37; there is no second client until story 3).
  useEffect(() => {
    if (import.meta.env.MODE !== "test") return;
    window.__vidi6Board = {
      deleteNote: (noteId: string) => deleteObject(document, noteId),
      seed: (seeds: SeedNote[]) => seedBoard(document, seeds),
    };
    return () => {
      delete window.__vidi6Board;
    };
  }, [document]);

  // Test-only: the badge hides when things are normal, which is indistinguishable
  // from "has never connected" by looking at the DOM (TC-29 watches the state
  // itself while two boards sit idle).
  useEffect(() => {
    if (import.meta.env.MODE !== "test") return;
    publishConnectionState(connection);
  }, [connection]);

  // Test-only: hand a test the means to cut this board's wire (TC-27). An
  // outage is more than the network being off: an established socket survives
  // that emulation, so the socket goes too and the retry then fails.
  useEffect(() => {
    if (import.meta.env.MODE !== "test") return;
    publishConnection(live);
    return () => publishConnection(null);
  }, [live]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Delete/Backspace while editing go to the text, never the note
      // (sticky.delete), and neither key acts on behalf of an input.
      if (isEditableTarget(event.target)) return;
      if (event.key === "Enter") {
        if (editingId !== null || selectedId === null || !editable) return; // TC-36, TC-23
        event.preventDefault();
        startEditing(selectedId);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        // Deleting is a change to the board, so it waits for the board (TC-23).
        if (editingId !== null || selectedId === null || !editable) return;
        event.preventDefault();
        deleteObject(document, selectedId);
        select(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [document, editable, editingId, selectedId, select, startEditing]);

  return (
    <>
      <BoardViewport
        onEmptySpaceClick={() => {
          select(null);
        }}
        onEmptySpaceDoubleClick={createAndEdit}
      >
        {/* Render in creation order, never in snapshot (z) order: restacking
            mid-drag would make React move the dragged element in the DOM,
            which drops pointer capture and kills the drag. Stacking itself
            comes from the note's own zIndex style. */}
        {[...notes]
          .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
          .map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              doc={document}
              zoom={board.camera.zoom}
              selected={selectedId === note.id}
              editing={editingId === note.id}
              editable={editable}
              onSelect={select}
              onStartEdit={startEditing}
              onEndEdit={endEdit}
            />
          ))}
      </BoardViewport>
      {/* Top centre, above every state of the board (live.status). It never
          covers a control and never disables one. */}
      <ConnectionStatus state={connection} />
      <Toolbar
        disabled={!editable}
        onCreateSticky={() => {
          // Centre of the visible board area, wherever the board is panned
          // (sticky.create_button, TC-34).
          const centre: Point = {
            x: board.viewport.width / 2,
            y: board.viewport.height / 2,
          };
          createAndEdit(screenToWorld(board.camera, centre));
        }}
      />
    </>
  );
}

/** The board route of story 3: `/b/:boardId` (a board id, nothing else). */
const BOARD_PATH = /^\/b\/([^/]+)$/;

/** The board id the current URL asks for, or `null` when it does not. */
function pathBoardId(): string | null {
  const id = BOARD_PATH.exec(window.location.pathname)?.[1] ?? null;
  return id !== null && isValidBoardId(id) ? id : null;
}

/**
 * The router, which is deliberately this small: read `/b/:boardId` back on
 * every history change, and when the URL is not a board (`/`, or an id that
 * could not be a board id) open a fresh board in its place.
 *
 * A client-side redirect is a placeholder: story 5 moves board creation and
 * `/b/:boardId` to the Worker, and this becomes a navigation away instead of a
 * rewrite. A malformed id never reaches the Worker as `/api/rooms/<id>` from
 * this app — the server still answers such a request with 400 (TC-04).
 */
function useBoardRoute(): string | null {
  const [boardId, setBoardId] = useState<string | null>(pathBoardId);

  useEffect(() => {
    if (boardId !== null) return;
    const fresh = newBoardId();
    window.history.replaceState(null, "", `/b/${fresh}`);
    setBoardId(fresh);
  }, [boardId]);

  useEffect(() => {
    const onPopState = (): void => setBoardId(pathBoardId());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return boardId;
}

export function App(): JSX.Element {
  const boardId = useBoardRoute();
  return (
    <div className="board-app" data-testid="board-app">
      <CameraProvider>
        <BoardContents boardId={boardId} />
        <BoardZoomControls />
        <BoardNavigationHint />
      </CameraProvider>
    </div>
  );
}
