/**
 * The board document, and the React read path to it (story 2).
 *
 * One `Y.Doc` owns all board data. React never reads Yjs directly: it
 * subscribes through `useSyncExternalStore` to an immutable snapshot that is
 * rebuilt only when the document changes. That keeps rendering a pure function
 * of the snapshot, and it is the seam story 3 uses to attach a network provider
 * and story 4 uses to persist the very same document.
 */
import { createElement, createContext, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import type { JSX, ReactNode } from 'react';
import * as Y from 'yjs';
import { initDoc, snapshot, type ObjectSnapshot } from '../../shared/board-model';

export interface BoardDoc {
  readonly doc: Y.Doc;
  /** Subscribe to any change to a board object (including note text). */
  subscribe(listener: () => void): () => void;
  /** Stable between changes: the same array while the document is untouched. */
  getSnapshot(): readonly ObjectSnapshot[];
  /** Release the observer. The document is not ours to destroy: the session
   * that built us decides whether the document goes too (story 8: an
   * injected document and its undo history must survive a board teardown). */
  destroy(): void;
}

function sameNote(a: ObjectSnapshot, b: ObjectSnapshot): boolean {
  if (a.type !== b.type) return false;
  if (a.x !== b.x || a.y !== b.y || a.z !== b.z || a.createdAt !== b.createdAt) return false;
  if (a.type === 'connector' && b.type === 'connector') {
    const fa = a.from; const fb = b.from;
    const ta = a.to; const tb = b.to;
    if (fa.kind !== fb.kind || ta.kind !== tb.kind) return false;
    if (fa.kind === 'free' && fb.kind === 'free' && (fa.x !== fb.x || fa.y !== fb.y)) return false;
    if (fa.kind === 'attached' && fb.kind === 'attached' && fa.objectId !== fb.objectId) return false;
    if (ta.kind === 'free' && tb.kind === 'free' && (ta.x !== tb.x || ta.y !== tb.y)) return false;
    if (ta.kind === 'attached' && tb.kind === 'attached' && ta.objectId !== tb.objectId) return false;
    return true;
  }
  if (a.type === 'shape' && b.type === 'shape') {
    return a.label === b.label && a.kind === b.kind && a.fill === b.fill && a.stroke === b.stroke
      && a.width === b.width && a.height === b.height;
  }
  return (
    ('text' in a ? (a as any).text === (b as any).text : true) &&
    ('color' in a ? (a as any).color === (b as any).color : true) &&
    ('size' in a ? (a as any).size === (b as any).size : true) &&
    ('width' in a ? (a as any).width === (b as any).width : true) &&
    ('height' in a ? (a as any).height === (b as any).height : true)
  );
}

/**
 * Wrap a document in a subscribable snapshot store.
 *
 * Rows are reused while a note is unchanged so a memoised note component can
 * skip re-rendering: dragging one note out of five hundred must not touch the
 * other four hundred and ninety-nine.
 */
export function createBoardDoc(doc: Y.Doc = new Y.Doc()): BoardDoc {
  initDoc(doc);
  const objects = doc.getMap<Y.Map<unknown>>('objects');

  const initial = snapshot(doc);
  let rows = new Map<string, ObjectSnapshot>(initial.map((row) => [row.id, row]));
  let current: readonly ObjectSnapshot[] = initial;

  const rebuild = (): void => {
    const next = snapshot(doc);
    const fresh = new Map<string, ObjectSnapshot>();
    let changed = next.length !== rows.size;
    for (const row of next) {
      const previous = rows.get(row.id);
      if (previous && sameNote(previous, row)) {
        fresh.set(row.id, previous);
      } else {
        fresh.set(row.id, row);
        changed = true;
      }
    }
    if (!changed) return;
    rows = fresh;
    current = next;
  };

  const listeners = new Set<() => void>();
  const handler = (): void => {
    rebuild();
    // Copied first: a listener may unsubscribe while we notify.
    for (const listener of [...listeners]) listener();
  };

  objects.observeDeep(handler);

  return {
    doc,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return current;
    },
    destroy() {
      listeners.clear();
      objects.unobserveDeep(handler);
      // Not `doc.destroy()`: React 19 development mode unmounts and remounts
      // every board, and an injected document (a harness, a persisted store,
      // a shared session) does not belong to one mount. Destroying it here
      // wiped the document's listeners - including an injected undo history -
      // between the two mounts, so the remounted board had no history at all.
    },
  };
}

/**
 * Where the document comes from. Story 3 provides a document wired to a
 * network provider and story 4 a persisted one; the component tree keeps
 * reading it through the same hook. Tests inject a seeded document here.
 */
export const BoardDocContext = createContext<BoardDoc | null>(null);

export function BoardDocProvider(props: { value: BoardDoc; children?: ReactNode }): JSX.Element {
  return createElement(BoardDocContext.Provider, { value: props.value }, props.children);
}

/**
 * The document to render: the one from context when there is one, otherwise a
 * private in-memory document created once per component instance.
 */
export function useBoardDoc(): BoardDoc {
  const provided = useContext(BoardDocContext);
  if (provided) return provided;
  const own = useRef<BoardDoc | null>(null);
  if (own.current === null) own.current = createBoardDoc();
  return own.current;
}

/** The current board contents, in render order (bottom note first). */
export function useBoardSnapshot(board: BoardDoc): readonly ObjectSnapshot[] {
  // Stable per document, so React does not resubscribe on every render.
  const { subscribe, getSnapshot } = useMemo(
    () => ({ subscribe: board.subscribe, getSnapshot: board.getSnapshot }),
    [board],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
