import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  isStickySnapshot,
  objectSnapshots,
  type ObjectSnapshot,
  type StickySnapshot,
} from '../../shared/board-model';
import {
  connectBoard,
  type BoardProvider,
  type ConnectionState,
} from '../sync/connectBoard';

/**
 * The board document, its render model, and its live connection.
 *
 * One `Y.Doc` per mounted board. Story 3 attaches the board's room to this same
 * document: local edits go out through the provider and other people's edits
 * come back into the same document, which is what re-renders the board.
 *
 * `snapshot()` is memoised and recomputed only when the document actually
 * changes, and it is exposed through `useSyncExternalStore` so React renders a
 * consistent, immutable view.
 */
export interface BoardDocOptions {
  /** A document to use instead of creating one (component tests). */
  doc?: Y.Doc;
  /** Which board this document is a copy of. */
  boardId: string;
  /** False keeps the connection away (component tests run without a server). */
  connect?: boolean;
  /**
   * The provider to reach the room with. Defaults to `y-websocket`; tests pass a
   * fake so a board can be driven through every connection state.
   */
  providerFactory?: (url: string, boardId: string, doc: Y.Doc) => BoardProvider;
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Sticky notes only - what stories 1-5 render and what the e2e hooks report. */
  readonly notes: readonly StickySnapshot[];
  /**
   * Every object on the board that has a registered type, in `(z, id)` order:
   * what story 7 selects, moves and resizes, whatever the object turns out to be
   * (`sel.all_types`).
   */
  readonly objects: readonly ObjectSnapshot[];
  readonly connectionState: ConnectionState;
}

/** The render model of one document, computed in one pass per change. */
interface BoardView {
  readonly notes: readonly StickySnapshot[];
  readonly objects: readonly ObjectSnapshot[];
}

const EMPTY: BoardView = Object.freeze({
  notes: Object.freeze([] as StickySnapshot[]),
  objects: Object.freeze([] as ObjectSnapshot[]),
});

export function useBoardDoc({
  doc: providedDoc,
  boardId,
  connect = true,
  providerFactory,
}: BoardDocOptions): BoardDoc {
  const docRef = useRef<Y.Doc | null>(null);
  if (docRef.current === null) {
    const doc = providedDoc ?? new Y.Doc();
    initDoc(doc);
    docRef.current = doc;
  }
  const doc = docRef.current;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    connect ? 'connecting' : 'connected',
  );

  // The room connection belongs to this document's lifetime: it is opened when
  // the board mounts and destroyed when it unmounts, so a board that is no
  // longer on screen keeps no socket open and makes no reconnection attempts.
  useEffect(() => {
    if (!connect) {
      setConnectionState('connected');
      return;
    }
    const connection = connectBoard(doc, boardId, {
      onState: setConnectionState,
      provider: providerFactory,
    });
    return () => {
      connection.destroy();
    };
  }, [boardId, connect, doc, providerFactory]);

  // `null` means "dirty": the next read recomputes both views.
  const cacheRef = useRef<BoardView | null>(null);

  const subscribe = useCallback(
    (listener: () => void) => {
      const objects = doc.getMap<unknown>('objects');
      const handler = () => {
        cacheRef.current = null;
        listener();
      };
      // observeDeep also fires for nested Y.Text changes (typing on a note).
      objects.observeDeep(handler);
      return () => {
        objects.unobserveDeep(handler);
      };
    },
    [doc],
  );

  const getSnapshot = useCallback((): BoardView => {
    let view = cacheRef.current;
    if (view === null) {
      // One pass over the document for both views: `objectSnapshots` reads every
      // object through its type's reader, and a sticky note's snapshot is one of
      // those, so `notes` is the sticky ones picked out of it.
      const objects = objectSnapshots(doc);
      view = Object.freeze({
        notes: objects.filter(isStickySnapshot),
        objects,
      });
      cacheRef.current = view;
    }
    return view;
  }, [doc]);

  const view = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return { doc, notes: view.notes, objects: view.objects, connectionState };
}
