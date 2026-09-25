/**
 * Board session: the object that ties one URL to one document and one
 * connection (story 3).
 *
 * The rule this file exists to enforce is *one board = one room*: opening a
 * URL creates exactly one document and exactly one connection for the room that
 * URL names, and leaving it tears both down. They are kept apart from the
 * drawing code so the connection can be tested without a network, and so a
 * board that is not a room at all (an unknown or missing link) gets a local
 * document instead of a silent connection to somewhere else.
 */
import { createContext, createElement, useContext, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import * as Y from 'yjs';
import { createBoardDoc, type BoardDoc } from '../board/useBoardDoc';
import {
  createConnection,
  roomUrl,
  type BoardConnection,
  type ConnectionOptions,
} from './connectBoard';

/** The id of a board that is not a room: a local document with nothing attached. */
export const LOCAL_BOARD = 'local';

export interface BoardSession {
  /** `'local'` for a local board, otherwise the room id. */
  readonly boardId: string;
  /** The room the board is shared in, or `null` when it is not shared. */
  readonly room: string | null;
  /** The socket URL that room maps to, for logs, the test hooks and tests. */
  readonly url: string | null;
  /** The document the board renders. */
  readonly doc: Y.Doc;
  /** The document plus the snapshot store the components read. */
  readonly board: BoardDoc;
  /** The connection, or `null` when this board is not shared. */
  readonly connection: BoardConnection | null;
  /** True once `destroy` has run. A destroyed session is never reused. */
  destroyed: boolean;
  destroy(): void;
}

export interface SessionOptions extends ConnectionOptions {
  /**
   * A document supplied from outside - a test harness, or story 4's restored
   * board. When it is given it is used as it is, and no new document is made.
   */
  doc?: Y.Doc;
  /** The socket origin. Defaults to the page's own host. */
  origin?: string;
}

/**
 * Build the session for `boardId`.
 *
 * `null` or `''` means "a board of my own": a local document with no
 * connection. That is what the PRD's `live.enter` asks for - a well-formed
 * link enters the room, anything else gets a local board and a warning rather
 * than a board wired to the wrong place.
 */
export function createSession(
  boardId: string | null,
  options: SessionOptions = {},
): BoardSession {
  const shared = boardId !== null && boardId !== '';
  const doc = options.doc ?? new Y.Doc();
  const board = createBoardDoc(doc);
  const origin = options.origin ?? (typeof window !== 'undefined' && window.location
    ? `${window.location.protocol}//${window.location.host}`
    : 'http://localhost:5173');
  // The provider is given the *server* URL and the room separately, because
  // `WebsocketProvider` appends `/room` itself. Handing it a URL that already
  // ends with the board id dials `/api/rooms/<id>/<id>`, which matches no
  // route: the handshake fails with 400, the badge sits on "Connecting" and
  // nobody shares anything. `url` below is the address the socket ends up
  // dialling, kept for display and for the tests.
  const server = roomUrl(origin);
  const url = shared ? `${server}/${boardId as string}` : null;
  const connection = shared
    ? createConnection({
        doc,
        room: boardId as string,
        url: server,
        options,
      })
    : null;
  const session: BoardSession = {
    boardId: shared ? (boardId as string) : LOCAL_BOARD,
    room: shared ? (boardId as string) : null,
    url,
    doc,
    board,
    connection,
    destroyed: false,
    destroy() {
      if (session.destroyed) return;
      session.destroyed = true;
      connection?.destroy();
      board.destroy();
    },
  };
  return session;
}

/**
 * The session for a board id, owned by React.
 *
 * A session is built the first time it is needed and destroyed by the effect
 * that owns it, and it is keyed on the board id by the caller: leaving a board
 * unmounts the board, which is what tears the old connection down. Two things
 * make this more than a `useMemo`:
 *
 * - React 19 mounts, unmounts and remounts every component in development. The
 *   cleanup leaves no session behind, and the remount builds a fresh one - a
 *   board must never inherit a connection that was already torn down.
 * - The session is not React state, so a board switch cannot render with the
 *   previous room's document still in place.
 */
export function useBoardSession(
  boardId: string | null,
  options: SessionOptions = {},
): BoardSession {
  const holder = useRef<BoardSession | null>(null);
  const [, setRevision] = useState(0);

  // The first render needs a document, so the session is built here rather
  // than in an effect; the effect below owns its lifetime.
  if (holder.current === null) holder.current = createSession(boardId, options);
  let session = holder.current;
  if (session.boardId !== (boardId ?? LOCAL_BOARD)) {
    // A board change without a remount (a caller that did not key the tree):
    // the old connection still belongs to the old room, so it goes now.
    session.destroy();
    session = createSession(boardId, options);
    holder.current = session;
  }

  useEffect(() => {
    if (holder.current === null) {
      // A remount after the cleanup below: build a live session and re-render
      // so the board reads it instead of the one that was torn down.
      holder.current = createSession(boardId, options);
      setRevision((revision) => revision + 1);
      return;
    }
    const current = holder.current;
    return () => {
      current.destroy();
      holder.current = null;
    };
    // `options` is deliberately not a dependency: a new factory is not a new
    // board, and re-creating on every render would drop a working connection.
  }, [boardId]);

  return session;
}

export const SessionContext = createContext<BoardSession | null>(null);

/** Makes `value` the session the board below it renders. */
export function SessionProvider(props: {
  value: BoardSession;
  children?: ReactNode;
}): JSX.Element {
  return createElement(SessionContext.Provider, { value: props.value }, props.children);
}

/** The session of the board being rendered, or `null` outside one. */
export function useSession(): BoardSession | null {
  return useContext(SessionContext);
}
