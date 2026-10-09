import * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import type { StickyColor } from '../../src/shared/config';
import { LOAD_ORIGIN } from '../../src/worker/board-store';

/**
 * Simulated remote peer (story 8 unit tests, undo.history).
 *
 * A second real Y.Doc that starts with a copy of the local board state.
 * Changes made through the peer are applied to the local doc with a
 * non-local origin (the same situation the real sync provider produces),
 * so a per-user UndoManager — which tracks LOCAL_ORIGIN only — never
 * captures them. This is deterministic: no server, no timing.
 */
export class Peer {
  /** Origin used for every update the peer pushes to the local doc. */
  static readonly ORIGIN: unique symbol = Symbol('peer-origin');

  readonly doc: Y.Doc;

  constructor(private readonly local: Y.Doc) {
    this.doc = new Y.Doc();
    // Start from the same state as the local doc (clone once).
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(local));
  }

  /**
   * The peer makes a change (usually via board-model helpers, which transact
   * on the peer doc) and the local doc receives it with a non-local origin.
   * (Full-state updates; applying is idempotent, test scale is tiny.)
   */
  change(fn: (doc: Y.Doc) => void): void {
    fn(this.doc);
    Y.applyUpdate(this.local, Y.encodeStateAsUpdate(this.doc), Peer.ORIGIN);
  }
}

/**
 * Apply an update to the local doc with the story 4 LOAD origin — the way a
 * room's first load from storage lands on a client doc (undo.history D1:
 * load changes are never captured).
 */
export function applyLoad(local: Y.Doc, fn: (doc: Y.Doc) => void): void {
  const tmp = new Y.Doc();
  fn(tmp);
  Y.applyUpdate(local, Y.encodeStateAsUpdate(tmp), LOAD_ORIGIN);
}

/**
 * Test fixture: write a fully-specified sticky (explicit size, colour, text)
 * in one LOCAL_ORIGIN transaction. Returns the id.
 */
export function seedSticky(
  doc: Y.Doc,
  at: { x: number; y: number },
  opts: { width?: number; height?: number; color?: StickyColor; text?: string } = {},
): string {
  const id = crypto.randomUUID();
  const objects = doc.getMap<any>('objects');
  let maxZ = 0;
  objects.forEach((item) => {
    const z = (item.get('z') as number) ?? 0;
    if (z > maxZ) maxZ = z;
  });
  const item = new Y.Map<any>();
  item.set('type', 'sticky');
  item.set('x', at.x);
  item.set('y', at.y);
  if (typeof opts.width === 'number') item.set('width', opts.width);
  if (typeof opts.height === 'number') item.set('height', opts.height);
  item.set('color', opts.color ?? 'yellow');
  const text = new Y.Text();
  if (opts.text) text.insert(0, opts.text);
  item.set('text', text);
  item.set('z', maxZ + 1);
  item.set('createdAt', Date.now());
  doc.transact(() => {
    objects.set(id, item as Y.Map<any>);
  }, LOCAL_ORIGIN);
  return id;
}
