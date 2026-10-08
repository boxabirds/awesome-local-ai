import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as Y from 'yjs';
import {
  initDoc,
  snapshot,
  OBJECTS_MAP,
  type StickySnapshot,
} from '../../shared/board-model';
import { textSnapshots, type TextSnapshot } from '../../shared/objects/text';
import { shapeSnapshots, type ShapeSnap } from '../../shared/objects/shape';
import { connectorSnapshots, type ConnectorSnap } from '../../shared/objects/connector';
import {
  connectBoard,
  type BoardConnection,
  type ConnectOptions,
  type ConnectionState,
  type ProviderLike,
} from '../sync/connectBoard';

/** Everything the board renders, read in one pass so one render sees one state. */
interface BoardObjects {
  readonly notes: readonly StickySnapshot[];
  readonly texts: readonly TextSnapshot[];
  readonly shapes: readonly ShapeSnap[];
  readonly connectors: readonly ConnectorSnap[];
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Sticky notes in paint order; a new array only when the document changed. */
  readonly notes: readonly StickySnapshot[];
  /** Free text objects in paint order (story 9), same read-your-write guarantee. */
  readonly texts: readonly TextSnapshot[];
  /** Shapes in paint order (story 10). */
  readonly shapes: readonly ShapeSnap[];
  /**
   * Connectors in paint order (story 10), with their ends resolved against wherever
   * their objects are *now* — which is why a moved object moves the arrow on every
   * screen without the arrow being written to again.
   */
  readonly connectors: readonly ConnectorSnap[];
  /** This board's connection, or null when the board is offline-by-construction. */
  readonly connection: BoardConnection | null;
  readonly connectionState: ConnectionState;
}

export interface UseBoardDocOptions {
  /** Attach the network provider (off in component tests). Default true. */
  sync?: boolean;
  /** Provider override used by the connection status component tests. */
  provider?: ProviderLike;
  /** Connection seams (fake clock / provider) for the badge tests. */
  connect?: ConnectOptions;
}

/**
 * Owns this page's `Y.Doc` for one board: `initDoc` for the shape, the network
 * provider for live collaboration (story 3), and an immutable snapshot exposed to
 * React through `useSyncExternalStore`, so renders are driven by `observeDeep` —
 * whether the change came from this keyboard or from another screen.
 *
 * `boardId` is the address of the board: changing it leaves one room and joins
 * another, destroying the old connection on the way.
 */
export function useBoardDoc(
  boardId: string,
  { sync = true, provider, connect }: UseBoardDocOptions = {},
): BoardDoc {
  const doc = useMemo(() => {
    const next = new Y.Doc();
    initDoc(next);
    return next;
  }, []);

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    sync ? 'connecting' : 'connected',
  );
  const [connection, setConnection] = useState<BoardConnection | null>(null);

  // The seams are read through a ref: passing a fresh options object on every
  // render must not reconnect the board.
  const seamsRef = useRef(connect);
  seamsRef.current = connect;

  useEffect(() => {
    if (!sync) return;
    const next = connectBoard(doc, boardId, setConnectionState, {
      ...seamsRef.current,
      provider,
    });
    setConnection(next);
    return () => {
      setConnection(null);
      next.destroy();
    };
  }, [doc, boardId, sync, provider]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const objects = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
      const changed = () => onStoreChange();
      objects.observeDeep(changed);
      return () => objects.unobserveDeep(changed);
    },
    [doc],
  );

  // `snapshot` is recomputed only when the document actually changed, and the
  // previous array is kept while nothing changed (the contract useSyncExternalStore
  // requires for getSnapshot).
  const cache = useMemo(() => {
    const read = (): BoardObjects => ({
      notes: snapshot(doc),
      texts: textSnapshots(doc),
      shapes: shapeSnapshots(doc),
      // Read after the shapes: a connector's ends are resolved against the rectangles
      // of the objects it points at, in the same pass, so nothing can disagree.
      connectors: connectorSnapshots(doc),
    });
    let current: BoardObjects = read();
    return {
      read(): BoardObjects {
        return current;
      },
      refresh(): void {
        current = read();
      },
    };
  }, [doc]);

  const getSnapshot = useCallback(() => cache.read(), [cache]);
  // Refresh the cached snapshot inside the subscription so the value returned by
  // getSnapshot is always up to date (and identical between changes).
  const subscribeAndRefresh = useCallback(
    (onStoreChange: () => void) =>
      subscribe(() => {
        cache.refresh();
        onStoreChange();
      }),
    [subscribe, cache],
  );

  const objects = useSyncExternalStore(
    subscribeAndRefresh,
    getSnapshot,
    getSnapshot,
  );

  return {
    doc,
    notes: objects.notes,
    texts: objects.texts,
    shapes: objects.shapes,
    connectors: objects.connectors,
    connection,
    connectionState,
  };
}
