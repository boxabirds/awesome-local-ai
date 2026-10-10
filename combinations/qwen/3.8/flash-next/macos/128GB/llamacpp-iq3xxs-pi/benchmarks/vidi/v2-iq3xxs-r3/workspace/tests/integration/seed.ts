/**
 * Getting a board into a stored shape that is worth testing (persist.room,
 * persist.board_store).
 *
 * A storage or room test starts from a stored state — a log, a snapshot plus a
 * log — and that state has to be built the way the product builds it: real
 * updates from `src/shared/board-model.ts`, appended through `BoardStore`. A
 * fixture of invented rows would let a test pass against a database shape the
 * product never writes.
 */
import * as Y from 'yjs';

import { BoardStore } from '../../src/worker/board-store';

import { countRows } from './broken-storage';

/** Apply every update to a doc, logging it in storage as it goes. */
export function applyAndLog(store: BoardStore, updates: readonly Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) {
    store.append(update);
    Y.applyUpdate(doc, update);
  }
  return doc;
}

/**
 * Type one more character into a note and log the update it produces — the
 * cheapest change a real board makes, which is what a log that has to reach a
 * certain length is made of.
 */
export function typeOneMoreCharacter(store: BoardStore, doc: Y.Doc, noteIndex: number): void {
  const notes = [...doc.getMap<Y.Map<unknown>>('objects').values()];
  const field = notes[noteIndex % notes.length]?.get('text');
  if (!(field instanceof Y.Text)) throw new Error('no note to type into');
  const captured: Uint8Array[] = [];
  const listener = (update: Uint8Array): void => {
    captured.push(update.slice());
  };
  doc.on('update', listener);
  field.insert(field.length, 'x');
  doc.off('update', listener);
  for (const update of captured) store.append(update);
}

/** Keep typing until the log holds `rows` rows. */
export function logUntilRows(
  store: BoardStore,
  storage: DurableObjectStorage,
  doc: Y.Doc,
  rows: number,
): void {
  let typed = 0;
  while (countRows(storage, 'updates') < rows) {
    typeOneMoreCharacter(store, doc, typed);
    typed += 1;
    if (typed > rows * 4) throw new Error(`could not grow the log to ${rows} rows`);
  }
}

/**
 * A board that has been folded: the log reaches the compaction threshold, the
 * fold happens, and what is left is a snapshot plus nothing. `Snapshotted` is a
 * stored state of its own (the coverage table's D1), and damage to it is the
 * most dangerous kind, so tests need to be able to stand in it.
 */
export function foldTheLog(
  store: BoardStore,
  storage: DurableObjectStorage,
  doc: Y.Doc,
  threshold: number,
): { readonly rows: number; readonly chunks: number } {
  logUntilRows(store, storage, doc, threshold);
  if (!store.compactIfNeeded(doc)) throw new Error('the log refused to fold');
  return { rows: countRows(storage, 'updates'), chunks: countRows(storage, 'snapshot_chunks') };
}

/**
 * What a piece of code wrote to `console.error` while it ran — which is how a
 * test says "the room said this out loud" (a board that quietly lost a change
 * is the failure this story exists to prevent).
 */
export function collectErrors(run: () => void): string[] {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    run();
  } finally {
    console.error = original;
  }
  return errors;
}
