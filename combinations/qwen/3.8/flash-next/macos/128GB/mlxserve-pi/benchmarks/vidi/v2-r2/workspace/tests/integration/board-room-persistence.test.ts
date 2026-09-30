// Story 4, room level (TC-12 to TC-18, TC-26): the guarantees that only exist
// when a real BoardRoom, its real sockets and its real SQLite storage run
// together in workerd.
//
// TC-12 is "seen is saved": by the time another client has seen a change, the row
// is in storage. TC-13 is "reopen after everyone left": a brand-new object over
// the same storage serves the same board. TC-14 is save failure - a write that
// fails is never broadcast, and the page that made it still holds it and gets it
// saved on reconnect. TC-15/TC-16 are load failure and its retry window; TC-26 is
// a read error inside that load. TC-17 is rejected garbage. TC-18 is the
// hibernation shape: a reconstructed object delivering to sockets it accepted
// before it forgot anything.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { abortAllDurableObjects } from 'cloudflare:test';
import {
  createSticky,
  getStickyText,
  initDoc,
  type StickySnapshot,
} from '../../src/shared/board-model';
import {
  armLoadReadFailure,
  armWriteFailure,
  damageSnapshot,
  deliverStrangerNote,
  diagnostics,
  forceCompact,
  pairedClients,
  repairSnapshot,
  reloadRoom,
  rewindLoadFailure,
  roomNotes,
  roomSocketCount,
  storedNotes,
  tableCount,
} from './helpers/room';
import { TestClient } from './helpers/ws-client';

/** Type `count` varied notes into `doc`, the way a person would. */
function typeNotes(doc: Y.Doc, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = createSticky(doc, { x: i * 240, y: (i % 5) * 200 }, i % 2 === 0 ? 'yellow' : 'blue');
    if (i % 2 === 0) getStickyText(doc, id)!.insert(0, `note ${i}`);
  }
}

/** Wait until the room describes itself the way the test expects. */
async function expectDiagnostics(id: string, check: (d: Awaited<ReturnType<typeof diagnostics>>) => boolean): Promise<void> {
  await expect.poll(async () => check(await diagnostics(id))).toBe(true);
}

describe('persistent room: durability and reopen (TC-12, TC-13)', () => {
  it('TC-12 stores an update before another client can see it', async () => {
    const { id, a, b } = await pairedClients();
    const noteId = createSticky(a.doc, { x: 10, y: 20 }, 'green');
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());

    // The change B has already seen is in storage, and storage alone reproduces it.
    const stored = await storedNotes(id);
    expect(stored.result).toEqual({ ok: true, quarantined: 0 });
    expect(stored.notes.some((note) => note.id === noteId)).toBe(true);
    expect(await tableCount(id, 'updates')).toBeGreaterThan(0);

    a.close();
    b.close();
  });

  it('TC-13 a new room instance over the same storage serves the same board', async () => {
    const { id, a, b } = await pairedClients();
    typeNotes(a.doc, 25);
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    const expected = a.snapshot();
    expect(expected.length).toBe(25);
    a.close();
    b.close();

    // The object is gone - memory and all - and a fresh one is built from storage
    // by the next connection.
    await abortAllDurableObjects();
    const c = await TestClient.connect(id);
    await c.waitForSync();
    expect(c.snapshot()).toEqual(expected);
    expect((await diagnostics(id)).state).toBe('ready');

    c.close();
  });
});

describe('persistent room: save failure (TC-14)', () => {
  it('TC-14 a write that fails is not broadcast, and is saved when the client reconnects', async () => {
    const { id, a, b } = await pairedClients();
    const before = await tableCount(id, 'updates');
    await armWriteFailure(id);

    const noteId = createSticky(a.doc, { x: 0, y: 0 });

    // Both sockets are closed with the storage-failure code; the change that could
    // not be written never reached the other client.
    await expect.poll(() => a.closeCode).toBe(1011);
    await expect.poll(() => b.closeCode).toBe(1011);
    expect(b.updateCount).toBe(0);
    expect(b.snapshot().some((note) => note.id === noteId)).toBe(false);
    expect(await tableCount(id, 'updates')).toBe(before);
    await expectDiagnostics(id, (d) => d.state === 'storage-failed' && !d.loaded);

    // The page that made the change still holds it, so reconnecting saves it: the
    // room reloads, asks the client for its state, and only then is it stored.
    await a.reconnect();
    await expect.poll(() => tableCount(id, 'updates')).toBeGreaterThan(before);
    await b.reconnect();
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    expect(b.snapshot().some((note) => note.id === noteId)).toBe(true);
    await expectDiagnostics(id, (d) => d.state === 'ready');

    a.close();
    b.close();
  });
});

describe('persistent room: load failure (TC-15, TC-16, TC-26)', () => {
  /** A board of 25 notes whose snapshot chunk 0 has been damaged. */
  async function damagedBoard(): Promise<{ id: string; damaged: number; expected: readonly StickySnapshot[] }> {
    const { id, a, b } = await pairedClients();
    typeNotes(a.doc, 25);
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    expect(await forceCompact(id)).toBe(true);
    const original = await damageSnapshot(id);
    if (original === null) throw new Error('compaction wrote no snapshot chunk');
    const expected = a.snapshot();
    a.close();
    b.close();
    await abortAllDurableObjects();
    return { id, damaged: original.byteLength, expected };
  }

  it('TC-15 an unreadable snapshot closes clients with 4500 and stores nothing', async () => {
    const { id, damaged, expected } = await damagedBoard();
    expect(damaged).toBeGreaterThan(0);
    const rows = await tableCount(id, 'updates');
    const chunks = await tableCount(id, 'snapshot_chunks');

    // A wake reads the storage and refuses to serve the board.
    expect(await reloadRoom(id)).toBe('load-failed');
    const d = await diagnostics(id);
    expect(d.state).toBe('load-failed');
    expect(d.loaded).toBe(false);
    expect(d.lastLoadError).toContain('snapshot-unreadable');

    // A client that arrives while the room is broken gets the load-failure code and
    // no content at all - not an empty board - and nothing it sends is written down.
    const c = await TestClient.connect(id);
    const stranger = new Y.Doc();
    initDoc(stranger);
    createSticky(stranger, { x: 0, y: 0 });
    const strangerState = Y.encodeStateAsUpdate(stranger);
    expect(strangerState.byteLength).toBeGreaterThan(0); // a real update the room must not take
    c.injectUpdate(strangerState);
    await expect.poll(() => c.closeCode).toBe(4500);
    expect(c.updateCount).toBe(0);
    expect(c.snapshot().length).toBe(0); // it was served nothing, not even an empty board
    expect(await tableCount(id, 'updates')).toBe(rows);
    expect(await tableCount(id, 'quarantined_updates')).toBe(0);
    // refusing a board is not the same as dismantling it: the snapshot is still
    // in one piece, which is what lets the repair in TC-16 work
    expect(await tableCount(id, 'snapshot_chunks')).toBe(chunks);

    c.close();
    expect(expected.length).toBe(25);
  });

  it('TC-16 a broken board is retried only after the retry interval, then syncs', async () => {
    const { id, expected } = await damagedBoard();

    // Arriving before the interval: refused with 4500.
    const first = await TestClient.connect(id);
    await expect.poll(() => first.closeCode).toBe(4500);
    first.close();
    const failed = await diagnostics(id);
    expect(failed.state).toBe('load-failed');
    const sinceFailure = failed.sinceLoadFailureMs;
    expect(sinceFailure).not.toBeNull();

    // ...and the storage was not read again in the meantime: the moment of failure
    // has only aged. A reload attempt - successful or not - would have moved it.
    const second = await TestClient.connect(id);
    await expect.poll(() => second.closeCode).toBe(4500);
    second.close();
    const later = await diagnostics(id);
    expect(later.state).toBe('load-failed');
    expect(later.sinceLoadFailureMs).not.toBeNull();
    expect(later.sinceLoadFailureMs! ).toBeGreaterThan(sinceFailure!);

    // The board is repaired, and the next connection is allowed to try again.
    expect(await repairSnapshot(id)).toBe(true);
    await rewindLoadFailure(id);
    const third = await TestClient.connect(id);
    await third.waitForSync();
    expect(third.snapshot()).toEqual(expected);
    await expectDiagnostics(id, (d) => d.state === 'ready' && d.loaded);

    third.close();
  });

  it('TC-26 a read error inside the load closes clients with 4500', async () => {
    const { id, a, b } = await pairedClients();
    typeNotes(a.doc, 25);
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());

    await armLoadReadFailure(id);
    expect(await reloadRoom(id)).toBe('load-failed');

    const d = await diagnostics(id);
    expect(d.state).toBe('load-failed');
    expect(d.lastLoadError).toContain('sql-error');
    // anyone watching is told, with the load-failure code rather than a blank board
    expect(a.closeCode).toBe(4500);
    expect(b.closeCode).toBe(4500);

    const c = await TestClient.connect(id);
    await expect.poll(() => c.closeCode).toBe(4500);
    c.close();

    // it was the read that failed, not the board: the next load works
    expect(await reloadRoom(id)).toBe('ready');
    expect(await roomNotes(id)).toHaveLength(25);
  });
});

describe('persistent room: garbage and hibernation (TC-17, TC-18)', () => {
  it('TC-17 an update Yjs rejects is never stored', async () => {
    const { id, a, b } = await pairedClients();
    const before = await tableCount(id, 'updates');

    a.injectUpdate(new Uint8Array([1, 2, 3, 250, 250, 250]));

    await expect.poll(() => a.closeCode).toBe(1003);
    expect(await tableCount(id, 'updates')).toBe(before);
    // the room goes on serving everyone else
    expect(b.closeCode).toBeNull();
    const c = await TestClient.connect(id);
    await c.waitForSync();
    expect(c.snapshot()).toEqual(b.snapshot());

    a.close();
    b.close();
    c.close();
  });

  it('TC-18 a reconstructed room delivers to the sockets it already had', async () => {
    const { id, a, b } = await pairedClients();
    typeNotes(a.doc, 25);
    await expect.poll(() => b.snapshot()).toEqual(a.snapshot());
    const before = await tableCount(id, 'updates');

    // The object forgets its memory and reads the board back, keeping the sockets
    // that connected before - which is what a hibernation wake looks like from
    // inside the runtime.
    expect(await reloadRoom(id)).toBe('ready');
    expect(await roomSocketCount(id)).toBe(2);
    expect(await roomNotes(id)).toEqual(a.snapshot());

    // A change arriving now has to reach the socket that was accepted earlier.
    const delivered = await deliverStrangerNote(id);
    const noteId = delivered.noteId;
    expect(delivered.sockets).toBe(2);
    expect(delivered.delivered).toBeGreaterThanOrEqual(0);

    const receiver = delivered.delivered === 0 ? a : b;
    const sender = delivered.delivered === 0 ? b : a;
    await expect.poll(() => receiver.snapshot().length).toBe(26);
    expect(receiver.snapshot().some((note) => note.id === noteId)).toBe(true);
    // and never echoed back to the socket it came in through
    expect(sender.snapshot().length).toBe(25);

    await expect.poll(() => tableCount(id, 'updates')).toBeGreaterThan(before);
    await expect.poll(async () => (await storedNotes(id)).notes.length).toBe(26);

    // the room also keeps serving sockets that arrive after the wake
    const c = await TestClient.connect(id);
    await c.waitForSync();
    expect(c.snapshot().some((note) => note.id === noteId)).toBe(true);

    a.close();
    b.close();
    c.close();
  });
});
