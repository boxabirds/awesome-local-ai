// persist.board_store integration tests: the real BoardStore contract
// (migrate, append, load, compactIfNeeded) against real Durable Object
// SQLite storage in workerd, isolated per test. TC-03 to TC-11, TC-25.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { env } from 'cloudflare:test';
import {
  COMPACTION_UPDATE_COUNT,
  PERSIST_TESTED_NOTES,
  STORAGE_SCHEMA_VERSION,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  moveObject,
  createSticky,
  getStickyText,
} from '../../src/shared/board-model';
import type { BoardRoom } from '../../src/worker/board-room';
import { __testSetCompactionFault } from '../../src/worker/board-store';
import {
  applyLargeNote,
  applyRetroNote,
  buildRetroBoard,
  notesOf,
} from '../fixtures/boards';

/** The board's DO stub, typed to the real class (the stub proxies the
 *  test seams to the object; tests and worker code share the isolate). */
async function roomFor(boardId: string): Promise<BoardRoom> {
  return (await env.BOARD_ROOM.get(
    env.BOARD_ROOM.idFromName(boardId),
  )) as unknown as BoardRoom;
}

/** Stable JSON of a board's notes (sorted so map order cannot matter). */
function notesJson(notes: { id: string }[]): string {
  return notes
    .map((n) => JSON.stringify(n))
    .sort()
    .join('\n');
}

/** One clean incremental Yjs update per applied board operation. */
class Updator {
  readonly doc = new Y.Doc();
  private sink = new Y.Doc();
  readonly updates: Uint8Array[] = [];

  step(op: () => void): Uint8Array {
    op();
    const update = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.sink));
    Y.applyUpdate(this.sink, update);
    this.updates.push(update);
    return update;
  }
}

/** One small board operation (create + type + move) as one update. */
function op(u: Updator, i: number): Uint8Array {
  return u.step(() => {
    const id = createSticky(u.doc, { x: (i * 37) % 2000, y: (i * 53) % 2000 }, 'yellow');
    const text = getStickyText(u.doc, id);
    if (text) text.insert(0, `note ${i} `);
    moveObject(u.doc, id, (i * 71) % 3000, (i * 29) % 3000);
  });
}

/** 500 small operations as 500 incremental updates. */
function manyOps(): Updator {
  const u = new Updator();
  for (let i = 0; i < COMPACTION_UPDATE_COUNT; i++) op(u, i);
  return u;
}

describe('persist.board_store', () => {
  it('TC-03: empty board — construct writes nothing; initialize sets schema version; load clean', async () => {
    const id = newBoardId();
    const room = await roomFor(id); // constructor loads (no migrate: story 5)

    // A probed board has NO tables (share.not_found negative).
    expect(await room.testTableNames()).toEqual([]);

    // initialize() (POST /api/boards) creates the schema and created_at.
    expect(await room.initialize()).toBe('created');

    const info = await room.testInspectStorage();
    expect(info.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(info.updates).toBe(0);
    expect(info.snapshotChunks).toBe(0);
    expect(info.quarantined).toBe(0);

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(0);
    expect(loaded.notes).toHaveLength(0);
  });

  it('TC-04: append one update -> exactly one row with bytes = length', async () => {
    const id = newBoardId();
    const room = await roomFor(id);

    const doc = new Y.Doc();
    createSticky(doc, { x: 1, y: 2 }, 'yellow');
    const update = Y.encodeStateAsUpdate(doc);
    expect(update.length).toBeGreaterThan(0);

    await room.testAppend(update);

    const info = await room.testInspectStorage();
    expect(info.updates).toBe(1);
    expect(info.updateBytes).toBe(update.length);
    expect(info.snapshotChunks).toBe(0);
  });

  it('TC-05: LogOnly — 25 varied notes load into a fresh doc identically', async () => {
    const id = newBoardId();
    const room = await roomFor(id);

    const doc = new Y.Doc();
    buildRetroBoard(doc);
    const original = notesOf(doc);
    await room.testAppend(Y.encodeStateAsUpdate(doc));

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(0);
    expect(loaded.notes).toHaveLength(original.length);
    expect(notesJson(loaded.notes)).toBe(notesJson(original));
  });

  it('TC-06: at COMPACTION_UPDATE_COUNT rows, compaction truncates the log; reload is equal', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    const u = manyOps();
    for (const update of u.updates) await room.testAppend(update);
    // The 500th append crossed the threshold: the room compacted on its own.

    const after = await room.testInspectStorage();
    expect(after.updates).toBe(0);
    expect(after.snapshotChunks).toBeGreaterThanOrEqual(1);
    expect(after.throughSeq).toBe(COMPACTION_UPDATE_COUNT);

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(0);
    expect(notesJson(loaded.notes)).toBe(notesJson(notesOf(u.doc)));
  });

  it('TC-07: snapshot plus 3 log rows — reload has everything', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    const u = manyOps();
    for (const update of u.updates) await room.testAppend(update);

    for (let i = 0; i < 3; i++) {
      const k = i;
      const update = u.step(() => {
        const nid = createSticky(u.doc, { x: 9000 + k, y: 9000 + k }, 'blue');
        getStickyText(u.doc, nid)?.insert(0, `post-compaction ${k}`);
      });
      await room.testAppend(update);
    }

    const info = await room.testInspectStorage();
    expect(info.updates).toBe(3);
    expect(info.throughSeq).toBe(COMPACTION_UPDATE_COUNT);

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(0);
    expect(notesJson(loaded.notes)).toBe(notesJson(notesOf(u.doc)));
  });

  it('TC-08: large board compaction — multiple chunks, reload equal', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    const u = new Updator();
    for (let i = 0; i < PERSIST_TESTED_NOTES; i++) {
      const update = u.step(() => applyLargeNote(u.doc, i));
      await room.testAppend(update);
    }
    // Compaction fired at each threshold crossing (500, 1000, 1500, 2000).

    const info = await room.testInspectStorage();
    expect(info.updates).toBe(0);
    // 2000 notes of real text encode beyond SNAPSHOT_CHUNK_BYTES (≈700 KB).
    expect(info.snapshotChunks).toBeGreaterThanOrEqual(2);

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(0);
    expect(loaded.notes).toHaveLength(PERSIST_TESTED_NOTES);
    expect(notesJson(loaded.notes)).toBe(notesJson(notesOf(u.doc)));
  }, 60_000);

  it('TC-09: damaged log row is quarantined with an error; the rest applies', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    // 25 notes created by 25 separate clients (as in a real workshop):
    // each stored update carries one client's items, so in Yjs clock space
    // losing one row cannot affect the other clients' notes.
    const noteIds: string[] = [];
    const perClientUpdates: Uint8Array[] = [];
    for (let i = 0; i < 25; i++) {
      const client = new Y.Doc();
      for (const prev of perClientUpdates) Y.applyUpdate(client, prev);
      const noteId = applyRetroNote(client, i);
      const server = new Y.Doc();
      for (const prev of perClientUpdates) Y.applyUpdate(server, prev);
      const update = Y.encodeStateAsUpdate(client, Y.encodeStateVector(server));
      noteIds.push(noteId);
      perClientUpdates.push(update);
      await room.testAppend(update);
    }

    // Damage log row 7 (seq 7, client 6's note) with its own bytes truncated.
    // Truncation is taken down to the 4-byte client header: Yjs integrates
    // items as it decodes, so a mid-stream truncation can leave most of the
    // note's items behind; a header-only truncation guarantees the row
    // contributes nothing and the decoder fails with "Unexpected end of array".
    const damaged = perClientUpdates[6].slice(0, 4);
    const written = await room.testOverwriteUpdateRow(7, damaged);
    expect(written).toBe(1);

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(loaded.quarantined).toBe(1);

    const info = await room.testInspectStorage();
    expect(info.updates).toBe(24);
    expect(info.quarantined).toBe(1);
    expect(info.quarantinedSeq).toBe(7);
    expect(info.quarantinedError).not.toBeNull();
    expect(info.quarantinedError?.length).toBeGreaterThan(0);

    // All 24 surviving notes are present; only the damaged row's note is
    // missing.
    const loadedIds = loaded.notes.map((n) => n.id);
    expect(loadedIds).toHaveLength(24);
    expect(loadedIds).not.toContain(noteIds[6]);
    for (let i = 0; i < 25; i++) {
      if (i === 6) continue;
      expect(loadedIds).toContain(noteIds[i]);
    }
  });

  it('TC-10: corrupt snapshot chunk 0 -> snapshot-unreadable; nothing deleted (negative)', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    const u = manyOps();
    for (const update of u.updates) await room.testAppend(update);
    // The 500th append compacted the log into a snapshot.
    expect((await room.testInspectStorage()).snapshotChunks).toBeGreaterThanOrEqual(1);

    const corrupted = await room.testCorruptSnapshot();
    expect(corrupted).toBe(1);

    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(false);
    expect(loaded.reason).toBe('snapshot-unreadable');

    const info = await room.testInspectStorage();
    expect(info.updates).toBe(0); // log untouched
    expect(info.quarantined).toBe(0); // nothing quarantined
    expect(info.snapshotChunks).toBe(1); // chunk still there (damaged)
  });

  it('TC-11: compaction fault rolls back; previous chunks and log intact (negative)', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    const u = manyOps();
    for (let i = 0; i < COMPACTION_UPDATE_COUNT - 1; i++) {
      await room.testAppend(u.updates[i]);
    }

    // The next append crosses the threshold: compaction runs and fails on
    // the injected fault, rolling the whole transaction back.
    __testSetCompactionFault(() => {
      throw new Error('injected compaction failure');
    });
    await room.testAppend(u.updates[COMPACTION_UPDATE_COUNT - 1]);

    const after = await room.testInspectStorage();
    expect(after.updates).toBe(COMPACTION_UPDATE_COUNT); // log intact
    expect(after.snapshotChunks).toBe(0); // no partial snapshot

    // The fault was one-shot: the log is still past the threshold, so the
    // very next append re-triggers compaction — this time cleanly, over all
    // 501 rows.
    await room.testAppend(op(u, COMPACTION_UPDATE_COUNT));
    const afterSecond = await room.testInspectStorage();
    expect(afterSecond.updates).toBe(0);
    expect(afterSecond.snapshotChunks).toBeGreaterThanOrEqual(1);

    // And the compacted board reloads equal.
    const loaded = await room.testLoadSnapshot();
    expect(loaded.ok).toBe(true);
    expect(notesJson(loaded.notes)).toBe(notesJson(notesOf(u.doc)));
  });

  it('TC-25: migrate on a never-edited board writes no update or chunk rows (negative)', async () => {
    const id = newBoardId();
    const room = await roomFor(id);
    expect(await room.testMigrate()).toBeUndefined();

    const info = await room.testInspectStorage();
    expect(info.updates).toBe(0);
    expect(info.snapshotChunks).toBe(0);
    expect(info.quarantined).toBe(0);
    expect(info.schemaVersion).toBe(String(STORAGE_SCHEMA_VERSION));
  });
});
