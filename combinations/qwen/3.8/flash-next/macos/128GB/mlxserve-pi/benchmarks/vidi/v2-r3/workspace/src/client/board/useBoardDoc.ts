// The board document, and the React side of keeping it up to date.
//
// The Y.Doc lives here and only here: one per mounted board, created before
// anything reads it and never recreated. The board room relays changes as yjs
// updates; the provider applies them to this document, and every one of them —
// the initial sync when the connection is established and each change from
// somebody else after that — arrives here as an `update` event whose origin is
// not this document's own editing. That is the only subscription the display
// needs: a local change repaints from the same event, because writing it goes
// through a transaction on this document too.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import { createSticky, deleteObject, moveObject, setStickyColor, snapshot, type StickySnapshot } from '../../shared/board-model';
import type { StickyColor } from '../../shared/config';
import { connectBoard, type BoardConnection, type ConnectionState } from '../sync/connectBoard';

export interface BoardDoc {
  /** The one document this board is built from. */
  doc: Y.Doc;
  /** The notes to draw, in the order the model gives them. */
  notes: readonly StickySnapshot[];
  /** False until the document has been read once. */
  ready: boolean;
  /** Where the connection to this board's room is. */
  connection: ConnectionState;
  /** Add a note, and return its id ('' if the document is gone). */
  addNote: (x: number, y: number, color?: StickyColor) => string;
  /** Write one note's position. */
  moveNote: (id: string, x: number, y: number) => void;
  /** Write one note's colour. */
  setColor: (id: string, color: StickyColor) => void;
  /** Remove one note. */
  deleteNote: (id: string) => void;
  /**
   * Lose the link to this board's room for a while, and let it come back. Only a
   * test asks for this; see `connectBoard`'s `emulateOutage`.
   */
  emulateOutage: (ms: number) => void;
}

/**
 * The board document for one board address, and its connection to that board's
 * room. The provider is created here and destroyed when this unmounts: one per
 * mounted board, never one per note, and never a second one when a parent
 * re-renders.
 */
export function useBoardDoc(
  boardId: string,
  onProvider?: (provider: WebsocketProvider) => void,
): BoardDoc {
  // One document for the lifetime of this mount. The board address is read
  // once and cannot change underneath it: arriving at a different address is
  // a different document and a fresh mount of this component.
  const [doc] = useState(() => new Y.Doc());
  const [notes, setNotes] = useState<readonly StickySnapshot[]>([]);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const providerReady = useRef(onProvider);
  providerReady.current = onProvider;

  useEffect(() => {
    // One read of the document per update event, published in the event itself:
    // a change that arrives is drawn in the task it arrives in, without a timer
    // and without a batch waiting for one.
    const scheduled = (): void => {
      setNotes(snapshot(doc));
      setReady(true);
    };

    // The initial load, and every change after it — this person's own and
    // everybody else's, which is the whole of what "live" means here.
    doc.on('update', scheduled);
    scheduled();

    return () => {
      doc.off('update', scheduled);
    };
  }, [doc]);

  // The connection to this board's room, for as long as this board is open.
  const board = useRef<BoardConnection | null>(null);
  useEffect(() => {
    const connection = connectBoard(doc, boardId, setConnection);
    board.current = connection;
    providerReady.current?.(connection.provider);
    return () => {
      board.current = null;
      connection.destroy();
    };
  }, [doc, boardId]);

  // The writes go through the model's own functions, which carry the document's
  // local origin: the same code path a test uses, and the one the room relays.
  const addNote = useCallback(
    (x: number, y: number, color?: StickyColor) => createSticky(doc, { x, y }, color),
    [doc],
  );

  const moveNote = useCallback((id: string, x: number, y: number) => void moveObject(doc, id, x, y), [doc]);

  const setColor = useCallback((id: string, color: StickyColor) => void setStickyColor(doc, id, color), [doc]);

  const deleteNote = useCallback((id: string) => void deleteObject(doc, id), [doc]);

  const emulateOutage = useCallback((ms: number) => board.current?.emulateOutage(ms), []);

  return { doc, notes, ready, connection, addNote, moveNote, setColor, deleteNote, emulateOutage };
}
