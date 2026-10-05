import { useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';

import {
  connectBoard,
  type BoardConnection,
  type BoardStatus,
  type ConnectBoardOptions,
} from './connection';

/** What `useBoardConnection` gives the board. */
export interface BoardConnectionHook {
  /** What the badge shows. `connected` when the board has no room to join at all. */
  status: BoardStatus;
  /** The live connection, or null when this board is not on the network. */
  connection: BoardConnection | null;
}

/**
 * Keeps a board's document in sync with its room.
 *
 * The provider is created once per board and torn down when the board is unmounted or
 * the address changes to a different board — never when the component merely re-renders,
 * because a re-render happens on every keystroke and dropping the socket on one would
 * be a very fragile way to lose other people's edits.
 *
 * `boardId === undefined` means "this board is not on the network": component tests
 * drive a document directly, and a board with no room has nothing to reconnect from.
 */
export function useBoardConnection(
  doc: Y.Doc,
  boardId: string | undefined,
  options: ConnectBoardOptions = {},
): BoardConnectionHook {
  // The first frame already says what is true: with a board to join, we are waiting for
  // it. Waiting for the effect to say so would leave one painted frame claiming a board
  // is live when the request has not even gone out.
  const [status, setStatus] = useState<BoardStatus>(() =>
    boardId === undefined ? 'connected' : 'connecting',
  );
  const [connection, setConnection] = useState<BoardConnection | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  // Read when the connection is made, never a reason to make it again: an options object
  // is a fresh one on every render, and a re-render must not drop the socket.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (boardId === undefined) {
      setStatus('connected');
      setConnection(null);
      return;
    }
    const created = connectBoard(docRef.current, boardId, setStatus, optionsRef.current);
    setConnection(created);
    return () => {
      created.destroy();
      setConnection(null);
    };
  }, [boardId]);

  // A board with no room is not "connecting" to anything: there is nothing there. The
  // board id answers that, not the connection — which is only filled in by the effect,
  // and a first frame that claimed "connected" while the request had not gone out would
  // be a first frame that lied.
  if (boardId === undefined) return { status: 'connected', connection: null };
  return { status, connection };
}
