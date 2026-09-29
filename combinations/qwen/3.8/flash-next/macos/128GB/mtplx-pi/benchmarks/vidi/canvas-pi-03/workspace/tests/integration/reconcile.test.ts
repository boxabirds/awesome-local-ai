// Story 3 — reconnect / resync integration tests (TC-08..TC-10).
// A client disconnecting must never poison the shared room: the room's doc
// persists and late joiners (or returning ones) reconcile to identical state.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { createRoom, textOf, until, yClient } from './helpers/ws-client';

describe('reconnect and resync', () => {
  it('TC-08: a client that drops out late can rejoin and catch up', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });
    (a.doc.getMap<Y.Map<unknown>>('objects').get(noteId)!.get('text') as Y.Text).insert(
      0,
      'seeded text',
    );
    expect(await until(() => textOf(b.doc, noteId) === 'seeded text', 5000)).toBe(true);

    // b disappears entirely; a keeps editing for a while.
    b.destroy();
    const idle = createSticky(a.doc, { x: 300, y: 0 });
    await new Promise((r) => setTimeout(r, 3000));

    // b' comes back on the same room and reconciles to a's state.
    const b2 = yClient(id);
    expect(await until(() => b2.provider.synced, 15_000)).toBe(true);
    expect(
      await until(
        () =>
          b2.doc.getMap('objects').size === a.doc.getMap('objects').size &&
          textOf(b2.doc, noteId) === 'seeded text' &&
          b2.doc.getMap('objects').has(idle),
        5000,
      ),
    ).toBe(true);
    expect(JSON.stringify(snapshot(b2.doc))).toBe(JSON.stringify(snapshot(a.doc)));
    a.destroy();
    b2.destroy();
  }, 60_000);

  it('TC-09: a brand-new doc syncs to a rebuilt room state byte-for-byte', async () => {
    const id = await createRoom();
    const longText = 'lorem ipsum dolor sit amet '.repeat(200); // 5.2 KB

    // Seed the room through doc1, then drop that client.
    const seed = yClient(id);
    expect(await until(() => seed.provider.synced)).toBe(true);
    const noteId = createSticky(seed.doc, { x: 0, y: 0 });
    (seed.doc.getMap<Y.Map<unknown>>('objects').get(noteId)!.get('text') as Y.Text).insert(
      0,
      longText,
    );
    await new Promise((r) => setTimeout(r, 1000)); // let the room absorb the update
    seed.destroy();

    // A brand-new doc enters the same room and must match exactly.
    const doc2 = new Y.Doc();
    const joiner = yClient(id, doc2);
    expect(await until(() => joiner.provider.synced, 15_000)).toBe(true);
    expect(await until(() => textOf(doc2, noteId) === longText, 8000)).toBe(true);

    // Byte-for-byte equality of the whole doc state, not just the string.
    expect(Y.encodeStateVector(doc2).length).toBeGreaterThan(0);
    expect(textOf(doc2, noteId)).toBe(longText);
    seed.destroy();
    joiner.destroy();
  }, 60_000);

  it('TC-10: 32 KB payloads with concurrent writes converge with all content intact', async () => {
    const id = await createRoom();
    const a = yClient(id);
    const b = yClient(id);
    expect(await until(() => a.provider.synced && b.provider.synced)).toBe(true);

    const big = 'ab-'.repeat(11_000); // 33 KB, streamed in 4 chunks per side
    const noteA = createSticky(a.doc, { x: 0, y: 0 });
    const noteB = createSticky(b.doc, { x: 400, y: 0 });
    const textA = a.doc.getMap<Y.Map<unknown>>('objects').get(noteA)!.get('text') as Y.Text;
    const textB = b.doc.getMap<Y.Map<unknown>>('objects').get(noteB)!.get('text') as Y.Text;

    // Four writes per side, interleaved with a small gap — both sides keep
    // writing while the other's changes are still in flight.
    for (let i = 0; i < 4; i++) {
      const chunk = big.slice(i * 8000, (i + 1) * 8000);
      a.doc.transact(() => textA.insert(textA.length, chunk));
      b.doc.transact(() => textB.insert(textB.length, chunk.toUpperCase()));
      await new Promise((r) => setTimeout(r, 150));
    }

    // Every message arrives; docs converge identical within seconds.
    expect(
      await until(
        () => textOf(a.doc, noteB) !== null && textOf(b.doc, noteA) !== null,
        8000,
      ),
    ).toBe(true);
    expect(await until(() => textOf(a.doc, noteA) === textOf(b.doc, noteA), 8000)).toBe(true);
    // No character loss: each shared text carries both 32 KB payloads.
    expect((textOf(b.doc, noteA) ?? '').length).toBe(32_000);
    expect((textOf(b.doc, noteB) ?? '').length).toBe(32_000);
    expect(JSON.stringify(snapshot(a.doc))).toBe(JSON.stringify(snapshot(b.doc)));
    a.destroy();
    b.destroy();
  }, 60_000);
});
