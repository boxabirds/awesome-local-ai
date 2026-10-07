// useBoardDoc (story 2): owns the Y.Doc and exposes an immutable snapshot of
// all sticky notes via useSyncExternalStore. Story 3 will attach a network
// provider to the same document; story 4 will persist it.
//
// Design: a `dirty` flag is set whenever the `objects` map changes (via
// observeDeep). getSnapshot recomputes the frozen snapshot only when dirty,
// otherwise it returns the cached array — satisfying useSyncExternalStore's
// requirement that getSnapshot return a stable reference until the store
// actually changes. Subscribing marks the store dirty once so that any change
// that landed before the observer was attached (e.g. a very fast interaction
// that beats the mount effect) is picked up on the next render.

import * as Y from 'yjs';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  initDoc,
  snapshot,
  type StickySnapshot,
} from '../../shared/board-model';

interface BoardStore {
  readonly doc: Y.Doc;
  listeners: Set<() => void>;
  current: readonly StickySnapshot[];
  dirty: boolean;
}

export interface BoardDoc {
  readonly doc: Y.Doc;
  readonly objects: readonly StickySnapshot[];
}

export function useBoardDoc(existing?: Y.Doc): BoardDoc {
  const ref = useRef<BoardStore | null>(null);
  if (ref.current === null) {
    const doc = existing ?? new Y.Doc();
    initDoc(doc);
    ref.current = {
      doc,
      listeners: new Set(),
      current: snapshot(doc),
      dirty: false,
    };
  }
  const store = ref.current;

  useEffect(() => {
    const s = ref.current;
    if (!s) return;
    const objects = s.doc.getMap('objects');
    // Any mutation that happened before this observer was attached is missed
    // by observeDeep, so mark the store dirty to force a recompute on the
    // next getSnapshot (and notify so a render is scheduled to pick it up).
    const markDirty = () => {
      s.dirty = true;
      s.listeners.forEach((l) => l());
    };
    // Any mutation that happened before this observer was attached is missed
    // by observeDeep, so mark the store dirty to force a recompute on the
    // next getSnapshot (and notify so a render is scheduled to pick it up).
    markDirty();
    objects.observeDeep(markDirty);
    return () => {
      objects.unobserveDeep(markDirty);
    };
  }, []);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      store.listeners.add(onStoreChange);
      return () => {
        store.listeners.delete(onStoreChange);
      };
    },
    [store],
  );
  const getSnapshot = useCallback(() => {
    if (store.dirty) {
      store.current = snapshot(store.doc);
      store.dirty = false;
    }
    return store.current;
  }, [store]);

  const objects = useSyncExternalStore(subscribe, getSnapshot);
  return { doc: store.doc, objects };
}
