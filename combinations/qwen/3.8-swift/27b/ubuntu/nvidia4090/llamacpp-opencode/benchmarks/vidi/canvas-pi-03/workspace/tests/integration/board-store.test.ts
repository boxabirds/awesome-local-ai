/**
 * Story 4: persist.board_store integration tests (TC-03..TC-11, TC-25) against
 * real Durable Object SQLite, driven through the test-only ops routes. Each
 * test uses a fresh board id so per-object storage never collides.
 *
 * Note: constructing a board's Durable Object runs `initDoc`, which stores one
 * schema row. So a fresh board has one log row (the schema) and zero notes.
 * Appended updates are complete histories (schema + notes) so they apply to the
 * board's doc on load.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import {
  initDoc,
  createSticky,
  getStickyText,
  snapshot,
} from 'src/shared/board-model';
import { newBoardId } from 'src/shared/board-id';
import { STORAGE_SCHEMA_VERSION, type StickyColor } from 'src/shared/config';
import { settleBoards } from './helpers/ws-client';
import { makeRetroBoard } from '../fixtures/boards';

const COLORS: StickyColor[] = ['yellow', 'orange', 'green', 'blue', 'pink', 'violet'];

afterEach(async () => {
  await settleBoards();
});

function b64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

interface OpResult {
  [key: string]: unknown;
}

async function op(boardId: string, name: string, body?: unknown): Promise<OpResult> {
  const res = await SELF.fetch(`http://localhost/__test/boards/${boardId}/${name}`, {
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as OpResult;
}

/**
 * Builds `n` notes and returns a COMPLETE history of incremental updates
 * (schema init + one per note) plus the final snapshot. A complete history
 * applies cleanly to the board's doc on load.
 */
function buildNotes(n: number, seed: number, withText = false): { updates: Uint8Array[]; notes: ReturnType<typeof snapshot> } {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  const handler = (u: Uint8Array) => updates.push(u);
  doc.on('update', handler);
  initDoc(doc); // schema init is part of the history
  for (let i = 0; i < n; i++) {
    const id = createSticky(doc, { x: (i % 50) * 25, y: Math.floor(i / 50) * 25 }, COLORS[i % COLORS.length], `n-${seed}-${i}`);
    // Text is optional: only the large board (TC-08) needs it so the encoded
    // snapshot exceeds SNAPSHOT_CHUNK_BYTES. Without text each note is a single
    // update, so damaging the last row removes a whole note (TC-09).
    if (id && withText) {
      getStickyText(doc, id)?.insert(0, `Note ${i}: a realistic phrase about the work to be done, with enough length to matter. ${'x'.repeat(40)}`);
    }
  }
  doc.off('update', handler);
  return { updates, notes: snapshot(doc) };
}

function sameNotes(a: unknown, b: unknown): boolean {
  const norm = (x: ReturnType<typeof snapshot>) =>
    JSON.stringify([...x].sort((p, q) => (p.id < q.id ? -1 : 1)));
  return norm(a as ReturnType<typeof snapshot>) === norm(b as ReturnType<typeof snapshot>);
}

describe('persist.board_store (real DO SQLite)', () => {
  it('TC-03: empty board → tables exist, doc empty, schema version set', async () => {
    const id = newBoardId();
    const out = await op(id, 'inspect');
    expect(out.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(out.chunkCount).toBe(0);
    expect(out.quarantinedCount).toBe(0);
    expect((out.notes as unknown[]).length).toBe(0);
  });

  it('TC-04: append one update → the note is stored and reloaded', async () => {
    const id = newBoardId();
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 }, 'yellow', 'n1');
    const update = Y.encodeStateAsUpdate(doc);
    await op(id, 'append', { updates: [b64(update)] });
    const load = await op(id, 'load');
    expect(load.ok).toBe(true);
    expect((load.notes as unknown[]).length).toBe(1);
    expect((load.notes as { id: string }[])[0].id).toBe('n1');
  });

  it('TC-05: LogOnly 25-note board → fresh load equals the original snapshot', async () => {
    const id = newBoardId();
    const board = makeRetroBoard();
    await op(id, 'append', { updates: [b64(board.update)] });
    const load = await op(id, 'load');
    expect(load.ok).toBe(true);
    expect(sameNotes(load.notes, board.notes)).toBe(true);
  });

  it('TC-06: at the compaction row threshold → compact empties log, reload equal', async () => {
    const id = newBoardId();
    // 500 notes → 501 complete-history updates → well over the 500-row threshold.
    const { updates, notes } = buildNotes(500, 1);
    await op(id, 'append', { updates: updates.map(b64) });
    const compact = await op(id, 'compact');
    expect(compact.compacted).toBe(true);
    expect(compact.logCount).toBe(0);
    expect(compact.chunks).toBeGreaterThanOrEqual(1);
    const load = await op(id, 'load');
    expect(load.ok).toBe(true);
    expect(sameNotes(load.notes, notes)).toBe(true);
  });

  it('TC-07: SnapshotPlusLog — updates after compaction are all reloaded', async () => {
    const id = newBoardId();
    const first = buildNotes(520, 2);
    await op(id, 'append', { updates: first.updates.map(b64) });
    await op(id, 'compact');
    // Three more notes after the snapshot (a complete history of a fresh doc).
    const extra = new Y.Doc();
    initDoc(extra);
    for (let i = 0; i < 3; i++) createSticky(extra, { x: 9000 + i, y: 0 }, 'pink', `extra-${i}`);
    await op(id, 'append', { updates: [b64(Y.encodeStateAsUpdate(extra))] });
    const load = await op(id, 'load');
    expect(load.ok).toBe(true);
    const notes = load.notes as ReturnType<typeof snapshot>;
    expect(notes.length).toBe(523);
    expect(notes.some((s) => s.id === 'extra-0')).toBe(true);
    expect(notes.some((s) => s.id === 'extra-2')).toBe(true);
  });

  it('TC-08: large board compaction → multiple chunks, reload identical', async () => {
    const id = newBoardId();
    const { updates, notes } = buildNotes(2000, 3, true);
    await op(id, 'append', { updates: updates.map(b64) });
    const compact = await op(id, 'compact');
    expect(compact.compacted).toBe(true);
    // 2000 notes (with text) encode well past SNAPSHOT_CHUNK_BYTES → several chunks.
    expect(compact.chunks).toBeGreaterThan(1);
    const load = await op(id, 'load');
    expect(load.ok).toBe(true);
    expect(sameNotes(load.notes, notes)).toBe(true);
  });

  it('TC-09: damaged log row → LoadResult ok with 1 quarantined, other notes intact', async () => {
    const id = newBoardId();
    const { updates, notes } = buildNotes(10, 4);
    await op(id, 'append', { updates: updates.map(b64) });
    // Damage the LAST note row (nothing after it to cascade). The board has 1
    // constructor-schema row, then our `updates.length` rows; the last note is
    // the final row.
    const lastSeq = updates.length + 1;
    // Same-length random bytes are guaranteed undecodable by Yjs.
    const dmg = await op(id, 'damage-log-row', { seq: lastSeq, mode: 'random' });
    expect(dmg.ok).toBe(true);
    const load = await op(id, 'load');
    expect(load.ok).toBe(true);
    expect(load.quarantined).toBe(1);
    const notesAfter = load.notes as ReturnType<typeof snapshot>;
    // Only the last note was quarantined → the other 9 remain.
    expect(notesAfter.length).toBe(notes.length - 1);
    expect(notesAfter.length).toBe(9);
  });

  it('TC-10: corrupted snapshot chunk → snapshot-unreadable, nothing deleted', async () => {
    const id = newBoardId();
    // Enough rows (>= 500) so compaction produces a snapshot to corrupt.
    const { updates } = buildNotes(520, 5);
    await op(id, 'append', { updates: updates.map(b64) });
    await op(id, 'compact');
    const corrupt = await op(id, 'corrupt-snapshot');
    expect(corrupt.ok).toBe(true);
    const load = await op(id, 'load');
    expect(load.ok).toBe(false);
    expect(load.reason).toBe('snapshot-unreadable');
    const inspect = await op(id, 'inspect');
    // Nothing deleted or quarantined by the failed load.
    expect(inspect.quarantinedCount).toBe(0);
    expect(inspect.chunkCount).toBeGreaterThanOrEqual(1);
  });

  it('TC-11: compaction failure mid-transaction → rollback, chunks and log unchanged', async () => {
    const id = newBoardId();
    const { updates } = buildNotes(520, 6);
    await op(id, 'append', { updates: updates.map(b64) });
    await op(id, 'compact'); // establish a snapshot first
    const out = (await op(id, 'compact-throw')) as {
      threw: boolean;
      rolledBack: boolean;
      beforeChunks: number;
      afterChunks: number;
      beforeUpdates: number;
      afterUpdates: number;
    };
    expect(out.threw).toBe(true);
    expect(out.rolledBack).toBe(true);
    expect(out.afterChunks).toBe(out.beforeChunks);
    expect(out.afterUpdates).toBe(out.beforeUpdates);
  });

  it('TC-25: migrate on a never-edited board writes no snapshot rows, doc stays empty', async () => {
    const id = newBoardId();
    const out = await op(id, 'inspect');
    expect(out.schemaVersion).toBe(STORAGE_SCHEMA_VERSION);
    expect(out.chunkCount).toBe(0);
    expect((out.notes as unknown[]).length).toBe(0);
  });
});
