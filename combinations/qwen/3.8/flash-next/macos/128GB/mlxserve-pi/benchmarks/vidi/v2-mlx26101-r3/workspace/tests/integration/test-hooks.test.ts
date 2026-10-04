import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { SELF } from 'cloudflare:test';
import { NO_FAULTS } from '../../src/worker/board-store';
import { damageSnapshot, repairSnapshot, snapshotChunks } from '../../src/worker/test-hooks';
import { noteSeeds, notesOf, writeNote } from '../fixtures/boards';
import { newBoardId } from '../../src/shared/board-id';
import {
  boardId,
  boardStub,
  countRows,
  insideBoard,
  openRoom,
  selectText,
} from './helpers/storage';

/**
 * What the test switches do, against the storage they do it to.
 *
 * TC-24 needs a board whose saved snapshot is damaged, and the damage has to be the real thing: a
 * row of the board's own table holding bytes that are not a board. That makes these functions worth
 * testing where the rows are, inside a Durable Object, with the room's own store reading back what
 * they wrote. The browser test of TC-24 says a person sees the right thing; this says that what they
 * are seeing is a board that genuinely could not be read, and that it came back because the row was
 * put back rather than because anything was rebuilt.
 *
 * The door these tests open is the one inside the object, called directly. The two doors that exist
 * in production code - the Worker's `/__test/...` route and the room's `/internal/test/...` one - are
 * tested from the other side instead, with the environment this project is configured with, which is
 * the deployment's configuration and has no `TEST_HOOKS` in it.
 */

/**
 * What a board holds, in values that can leave a Durable Object.
 *
 * Without the note ids, because the two documents being compared were written by two different
 * writers and a note's id is the writer's own choice. What has to be the same after a repair is the
 * board a person would see - which note, what text, where, what colour, in what order - and the ids
 * being different is correct rather than a difference to explain.
 */
function contentOf(doc: Y.Doc): {
  text: string;
  x: number;
  y: number;
  color: string;
  z: number;
}[] {
  return notesOf(doc)
    .map((note) => ({ text: note.text, x: note.x, y: note.y, color: note.color, z: note.z }))
    .sort((a, b) => a.text.localeCompare(b.text) || a.x - b.x || a.y - b.y);
}

/** Write a board and fold it up, so there is a snapshot of known content to damage. */
function boardWithASnapshot(id: string): Promise<{
  content: ReturnType<typeof contentOf>;
  chunks: number;
}> {
  return insideBoard(boardStub(id), (store, storage) => {
    const doc = new Y.Doc();
    for (const note of noteSeeds()) {
      writeNote(doc, note);
    }
    // Forced. The fold-up a room does by itself after hundreds of changes is this same fold-up, and
    // a test that waited for the threshold honestly would have to make hundreds of rows first.
    store.compactIfNeeded(doc, true);
    return { content: contentOf(doc), chunks: snapshotChunks({ storage }) };
  });
}

/** Read the board back inside the object, and say what the read was like in plain values. */
function readTheBoard(id: string): Promise<{ ok: boolean; reason: string | null }> {
  return insideBoard(boardStub(id), (store) => {
    const doc = new Y.Doc();
    const result = store.load(doc);
    return result.ok ? { ok: true, reason: null } : { ok: false, reason: result.reason };
  });
}

describe('damaging and repairing a stored snapshot (TC-24)', () => {
  it('a snapshot of bytes that are not a board cannot be read, and the row put back can (TC-15)', async () => {
    const id = boardId();
    const before = await boardWithASnapshot(id);
    expect(before.chunks).toBeGreaterThan(0);
    expect(before.content.length).toBeGreaterThan(0);

    const damage = await insideBoard(boardStub(id), (_store, storage) =>
      damageSnapshot({ storage }),
    );
    expect(damage.saved).toBe(true);
    expect(damage.bytes).toBeGreaterThan(0);
    // One row changed, and no row added or lost: this is a board that is still there and cannot be
    // read, not a board that has been emptied.
    expect(await countRows(boardStub(id), 'snapshot_chunks')).toBe(before.chunks);

    expect(await readTheBoard(id)).toEqual({ ok: false, reason: 'snapshot-unreadable' });

    const repair = await insideBoard(boardStub(id), (_store, storage) =>
      repairSnapshot({ storage }),
    );
    expect(repair).toEqual({ repaired: true });

    expect(await readTheBoard(id)).toEqual({ ok: true, reason: null });
    // And the board that comes back is the board that went away, read out of the same rows.
    const after = await insideBoard(boardStub(id), (store) => {
      const doc = new Y.Doc();
      return store.load(doc).ok ? contentOf(doc) : [];
    });
    expect(after).toEqual(before.content);
  });

  it('says so when there is nothing to damage, and nothing to put back (negative)', async () => {
    const id = boardId();
    // A board that was written but never folded up has a log and no snapshot. Damaging "the
    // snapshot" of it has to be refused: a test that went on from there would be watching a board
    // that was never damaged fail to load, which is a fact about nothing.
    const refused = await insideBoard(boardStub(id), (store, storage) => {
      const doc = new Y.Doc();
      writeNote(doc, { text: 'nothing folded', x: 0, y: 0, color: 'yellow' });
      // Not forced: this is the state a board of this size is really in.
      store.compactIfNeeded(doc);
      try {
        damageSnapshot({ storage });
        return { refused: false, message: '' };
      } catch (error) {
        return { refused: true, message: error instanceof Error ? error.message : String(error) };
      }
    });
    expect(refused.refused).toBe(true);
    expect(refused.message).toContain('no snapshot');
    expect(await countRows(boardStub(id), 'snapshot_chunks')).toBe(0);

    // The same honesty about repairing: nothing was taken out, so nothing can be put back, and a
    // test that assumed a repair had happened would be watching a recovery from nothing.
    const untouched = await insideBoard(boardStub(id), (_store, storage) =>
      repairSnapshot({ storage }),
    );
    expect(untouched).toEqual({ repaired: false });
  });

  it('leaves the rest of the board alone while it is damaged', async () => {
    // The damage is to one row of one table. The log, the metadata and the quarantine table are the
    // store's own business and a test switch has no business touching them - and a table the store
    // does not know about, left behind, would be a schema nobody reads.
    const id = boardId();
    await boardWithASnapshot(id);
    await insideBoard(boardStub(id), (_store, storage) => damageSnapshot({ storage }));
    const tables = await insideBoard(boardStub(id), (_store, storage) => {
      const names: string[] = [];
      for (const row of storage.sql.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )) {
        names.push(String(row['name']));
      }
      return names;
    });
    expect(tables).toEqual(
      expect.arrayContaining([
        'updates',
        'snapshot_chunks',
        'quarantined_updates',
        'storage_meta',
        // The switch's own table, which is there while a damage is waiting to be undone.
        'test_hook_saved',
      ]),
    );

    await insideBoard(boardStub(id), (_store, storage) => repairSnapshot({ storage }));
    // The metadata the store reads on every load is untouched by any of this.
    expect(
      await selectText(boardStub(id), `SELECT value FROM storage_meta WHERE key = 'storage_schema_version'`),
    ).toBe('1');
  });
});

describe('the doors, with the switches left off (TC-24, negative)', () => {
  it('the room will not damage its own storage because somebody asked', async () => {
    // This project runs the Worker configuration as it is deployed, and the deployment has no
    // TEST_HOOKS. The room's own door is the second gate: anything that can reach a Durable Object
    // can name any path, and the answer to being asked to write garbage over a board is the same
    // answer this room gives to any other request that is not a connection.
    const stub = boardStub(boardId());
    expect(await openRoom(stub)).toBe(426);
    const response = await stub.fetch(
      new Request('http://board-room/internal/test/corrupt-snapshot', { method: 'POST' }),
    );
    expect(response.status).toBe(404);
    // And the room is a room afterwards: not in a load failure, not without its tables, its board
    // still readable.
    expect(await countRows(stub, 'storage_meta')).toBeGreaterThan(0);
    expect(
      await insideBoard(
        stub,
        (store) => {
          const doc = new Y.Doc();
          return store.load(doc).ok;
        },
        { faults: NO_FAULTS },
      ),
    ).toBe(true);
    expect(
      await stub.fetch(new Request('http://board-room/internal/test/read-again', { method: 'POST' })),
    ).toHaveProperty('status', 404);
  });

  it('a deployment has no route to a test switch at all', async () => {
    // `/__test/*` is in `run_worker_first`, so this request does reach the Worker. What it does not
    // find there is a route, and the request goes on to the assets the way every other path this
    // Worker does not claim goes: a GET is answered with the app, which is what a person who guessed
    // the path gets in production, and a POST is answered by the asset router, which serves no
    // method but GET and HEAD. Neither answer is "ok, it is damaged now". The switch is not a route
    // that is turned off in a deployment; it is a route that was never added.
    const path = `/__test/boards/${newBoardId()}/corrupt-snapshot`;
    const page = await SELF.fetch(`http://mock${path}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type') ?? '').toContain('text/html');
    expect((await SELF.fetch(`http://mock${path}`, { method: 'POST' })).status).toBe(405);

    // The same for a path that is not even shaped like a switch.
    const unknown = await SELF.fetch('http://mock/__not_a_switch_either');
    expect(unknown.status).toBe(200);
    expect(unknown.headers.get('content-type') ?? '').toContain('text/html');
  });
});
