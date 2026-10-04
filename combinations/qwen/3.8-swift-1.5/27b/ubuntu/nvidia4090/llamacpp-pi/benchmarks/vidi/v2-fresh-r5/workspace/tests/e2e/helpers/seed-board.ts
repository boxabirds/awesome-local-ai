/**
 * Seed a board's persisted state directly through the room (a Node Yjs client
 * speaking y-websocket), bypassing the browser. Used by the "big board open"
 * case to create PERSIST_TESTED_NOTES notes before a fresh browser context
 * opens the board and renders them.
 *
 * Node's global WebSocket is not what y-websocket expects in this runtime, so
 * the `ws` package implementation is passed explicitly.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WS from 'ws';
import {
  createSticky,
  getStickyText,
  initDoc,
} from '../../../src/shared/board-model';
import { STICKY_COLORS, type StickyColor } from '../../../src/shared/config';
import { createBoard } from './api';

const ALL_COLORS = Object.keys(STICKY_COLORS) as StickyColor[];

/** Deterministic pseudo-random in [0, 1) for varied note text. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create `nNotes` notes on the board at `/api/rooms/<boardId>` on `port`,
 * laid out on a grid so they occupy distinct positions. Resolves once the
 * provider has synced and the writes have had time to flush to storage.
 * Story 5: the board is created via POST /api/boards first; returns its id.
 */
export async function seedBoard(
  port: number,
  nNotes: number,
): Promise<string> {
  const boardId = await createBoard(`http://127.0.0.1:${port}`);
  const doc = new Y.Doc();
  initDoc(doc);
  const provider = new WebsocketProvider(
    `ws://127.0.0.1:${port}/api/rooms`,
    boardId,
    doc,
    { WebSocketPolyfill: WS as unknown as typeof WebSocket },
  );
  try {
    await new Promise<void>((resolve) => {
      provider.on('sync', (s: boolean) => {
        if (s) resolve();
      });
      setTimeout(resolve, 20_000);
    });

    const rng = mulberry32(1234);
    const cols = Math.ceil(Math.sqrt(nNotes));
    const gap = 260; // > STICKY_SIZE_WORLD so notes never overlap
    for (let i = 0; i < nNotes; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const id = createSticky(doc, { x: col * gap, y: row * gap }, ALL_COLORS[i % ALL_COLORS.length]);
      const text = getStickyText(doc, id);
      if (text) text.insert(0, `seed ${i} ${Math.floor(rng() * 1000)}`);
    }

    // Give the room time to persist (append-before-broadcast) before we close.
    await new Promise((r) => setTimeout(r, 3000));
  } finally {
    provider.destroy();
    doc.destroy();
  }
  return boardId;
}
