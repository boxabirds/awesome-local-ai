// A second, real Y.Doc that behaves like a colleague on the same board, for unit
// tests of the undo controller: it edits its own copy and the two copies exchange
// updates through the same Yjs encoding the sockets carry.
//
// The point of the fixture is the ORIGIN the updates arrive with. In the app a
// colleague's change lands on the local doc through the provider (never
// `LOCAL_ORIGIN`), and a board read back from storage lands through story 4's
// `LOAD_ORIGIN`; both must be invisible to this tab's undo history. Here the peer
// applies its updates with `PROVIDER_ORIGIN` and `loadBoard`/`applyLoadUpdate`
// apply with the real `LOAD_ORIGIN` the board store uses.
import * as Y from 'yjs';
import { LOAD_ORIGIN } from '../../../src/worker/board-store.ts';
import { initDoc, type StickySnapshot } from '../../../src/shared/board-model.ts';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config.ts';

/** What the y-websocket provider's origin stands for: "someone else said this". */
export const PROVIDER_ORIGIN: unique symbol = Symbol('test.provider');

export interface Peer {
  /** The colleague's own document; mutate it with `transact`. */
  readonly doc: Y.Doc;
  /** Run a mutation on the colleague's copy, then hand it over. */
  transact(fn: (doc: Y.Doc) => void): void;
  /** Every outstanding change both ways, as the provider would deliver them. */
  sync(): void;
}

/**
 * Attach a colleague to `local`, starting from the state `local` already holds —
 * which is what a person who joins a board does: they receive it, they did not
 * make it.
 */
export function createPeer(local: Y.Doc): Peer {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(local), PROVIDER_ORIGIN);

  const deliver = (from: Y.Doc, to: Y.Doc): void => {
    // A provider applies what the other side sent; the origin it passes is the
    // transport, never the local user's origin.
    Y.applyUpdate(to, Y.encodeStateAsUpdate(from), PROVIDER_ORIGIN);
  };

  const peer: Peer = {
    doc,
    transact(fn: (d: Y.Doc) => void): void {
      fn(doc);
      deliver(doc, local);
    },
    sync(): void {
      deliver(doc, local);
      deliver(local, doc);
    },
  };
  return peer;
}

/** Apply an update the way story 4's load path does: origin LOAD_ORIGIN. */
export function applyLoadUpdate(doc: Y.Doc, update: Uint8Array): void {
  Y.applyUpdate(doc, update, LOAD_ORIGIN);
}

export interface SeedNote {
  x: number;
  y: number;
  width?: number;
  height?: number;
  color?: StickyColor;
  text?: string;
}

/**
 * A board as it exists a moment before this tab opens it: the notes are written
 * somewhere else and arrive through the load origin, so none of them is this
 * person's own change and none of them is undoable.
 */
export function loadBoard(notes: readonly SeedNote[]): Y.Doc {
  const source = new Y.Doc();
  initDoc(source);
  source.transact(() => {
    notes.forEach((note, i) => {
      const m = new Y.Map<unknown>();
      m.set('type', 'sticky');
      m.set('x', note.x);
      m.set('y', note.y);
      if (note.width !== undefined) m.set('width', note.width);
      if (note.height !== undefined) m.set('height', note.height);
      m.set('color', note.color ?? 'yellow');
      m.set('text', new Y.Text(note.text ?? ''));
      m.set('z', i + 1);
      m.set('createdAt', 0);
      source.getMap<Y.Map<unknown>>('objects').set(`note-${i}`, m);
    });
  });
  const doc = new Y.Doc();
  initDoc(doc);
  applyLoadUpdate(doc, Y.encodeStateAsUpdate(source));
  return doc;
}

/** The notes of a doc by their object id, for assertions that name one object. */
export function notesById(doc: Y.Doc): Map<string, StickySnapshot> {
  const out = new Map<string, StickySnapshot>();
  for (const m of doc.getMap<Y.Map<unknown>>('objects')) {
    const [id, value] = m as [string, Y.Map<unknown>];
    const text = value.get('text');
    const color = String(value.get('color')) as StickyColor;
    out.set(id, {
      id,
      type: 'sticky',
      x: Number(value.get('x')),
      y: Number(value.get('y')),
      z: Number(value.get('z')),
      createdAt: Number(value.get('createdAt')),
      width: value.has('width') ? Number(value.get('width')) : undefined,
      height: value.has('height') ? Number(value.get('height')) : undefined,
      color: color in STICKY_COLORS ? color : 'yellow',
      text: text instanceof Y.Text ? text.toString() : '',
    });
  }
  return out;
}
