import * as Y from 'yjs';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { createDecoder, readVarUint, readVarUint8Array } from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import { MESSAGE_SYNC, SYNC_STEP1, SYNC_STEP2, SYNC_UPDATE } from '../../../src/shared/protocol';
import { createSticky, getStickyText } from '../../../src/shared/board-model';
import type { StickyColor } from '../../../src/shared/config';
import { buildNoteBoard } from '../../fixtures/note-updates';
import { PERSIST_PORT } from './wrangler-process';

/**
 * Seed a board through a real WebSocket client (story 4, task 6, TC-21).
 *
 * Speaks the same y-websocket protocol a browser uses: Step1 out, Step1/Step2
 * in, then the whole fixture board as one Step2 update. The room stores it
 * through the normal append path (one log row), exactly as if one client had
 * produced the board. The board is a fresh Yjs doc built in Node, so the
 * bytes are real Yjs updates (design: "Fixtures").
 */
export async function seedBoard(
  boardId: string,
  count: number,
  timeoutMs = 90_000,
): Promise<void> {
  const fixture = buildNoteBoard(boardId, count);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`seeding ${count} notes timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    const ws = new WebSocket(`ws://127.0.0.1:${PERSIST_PORT}/api/rooms/${boardId}`);
    ws.binaryType = 'arraybuffer';
    const done = (): void => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve();
    };
    ws.onopen = () => {
      // We hold the whole board; announce our state vector.
      const enc = createEncoder();
      writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, fixture.doc);
      ws.send(toUint8Array(enc));
    };
    ws.onmessage = (event) => {
      const decoder = createDecoder(new Uint8Array(event.data as ArrayBuffer));
      const type = readVarUint(decoder);
      if (type !== MESSAGE_SYNC) return;
      const syncType = readVarUint(decoder);
      if (syncType === SYNC_STEP1) {
        // The room asks for what it lacks: answer with the whole board.
        const serverSv = readVarUint8Array(decoder);
        const sv =
          serverSv.length > 0 ? serverSv : Y.encodeStateVector(new Y.Doc());
        const enc = createEncoder();
        writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(enc, fixture.doc, sv);
        ws.send(toUint8Array(enc));
        // That Step2 carried the entire board (the room was empty). Give
        // the room's append a moment to land, then leave like any client
        // closing a tab.
        setTimeout(done, 1_000);
      } else if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        // The room's own state (empty on a fresh board) or a relay.
        const update = readVarUint8Array(decoder);
        if (update.length > 0) Y.applyUpdate(fixture.doc, update, 'room');
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('seed WebSocket error'));
    };
  });
}

/**
 * Seed a board through many individual y-websocket SYNC_UPDATE messages
 * (story 4, task 9, TC-24) instead of one merged Step2.
 *
 * Why: TC-24 needs a board whose log has crossed the compaction threshold
 * (COMPACTION_UPDATE_COUNT appends), so its state lives in a chunked
 * snapshot that the /__test/corrupt-snapshot hook can break. Each mutation
 * below is captured as its own update (state-vector diff, so Yjs cannot
 * coalesce two mutations into one) and sent as a separate SYNC_UPDATE frame;
 * the room appends each one, and the 500th append triggers compaction.
 *
 * Mutations are executed ONLINE (one at a time, in lockstep with the frames)
 * on purpose: the doc must be empty when the handshake's Step2 goes out,
 * otherwise the room would receive the whole board as one update and the
 * individual frames would be no-ops.
 *
 * The filler updates toggle a top-level scratch text (insert 'x' / delete
 * 'x') that is NOT a note: it reaches the threshold without adding a single
 * rendered sticky.
 */
export async function seedBoardWithCompaction(
  boardId: string,
  noteCount: number,
  targetUpdates: number,
  buildNote: (i: number) => { x: number; y: number; text: string; color?: StickyColor },
  timeoutMs = 90_000,
): Promise<void> {
  const doc = new Y.Doc();
  // NOTE: the scratch text is only touched once (its first insert), so it
  // must be created lazily inside the mutation, not here — a pre-created
  // empty Y.Text would make the doc's state vector non-empty at handshake
  // time (the Step2 would then carry it).
  const mutations: (() => void)[] = [];
  for (let i = 0; i < noteCount; i += 1) {
    const note = buildNote(i);
    mutations.push(() => {
      const id = createSticky(doc, { x: note.x, y: note.y }, note.color);
      getStickyText(doc, id)!.insert(0, note.text);
    });
  }
  // Filler: insert/delete pairs on the scratch text (net-zero content).
  while (mutations.length < targetUpdates) {
    mutations.push(() => {
      const scratch = doc.getText('__seed_scratch');
      scratch.insert(scratch.length, 'x');
    });
    mutations.push(() => {
      const scratch = doc.getText('__seed_scratch');
      scratch.delete(scratch.length - 1, 1);
    });
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`compaction seeding timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    const ws = new WebSocket(`ws://127.0.0.1:${PERSIST_PORT}/api/rooms/${boardId}`);
    ws.binaryType = 'arraybuffer';
    let next = 0;
    const done = (): void => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // already closed
      }
      resolve();
    };
    const sendNext = (): void => {
      while (next < mutations.length && ws.readyState === WebSocket.OPEN) {
        const before = Y.encodeStateVector(doc);
        mutations[next]!();
        const update = Y.encodeStateAsUpdate(doc, before);
        const enc = createEncoder();
        writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        ws.send(toUint8Array(enc));
        next += 1;
      }
      if (next === mutations.length) {
        // The last append triggered the room's compaction. Give the write
        // a moment to be durable, then leave like any client closing a tab.
        setTimeout(done, 1_500);
      }
    };
    ws.onopen = () => {
      const enc = createEncoder();
      writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(enc, doc);
      ws.send(toUint8Array(enc));
    };
    ws.onmessage = (event) => {
      const decoder = createDecoder(new Uint8Array(event.data as ArrayBuffer));
      const type = readVarUint(decoder);
      if (type !== MESSAGE_SYNC) return;
      const syncType = readVarUint(decoder);
      if (syncType === SYNC_STEP1) {
        // The room (empty) asks for what it lacks: our current state, which
        // is still nothing — the mutations follow as individual SYNC_UPDATE
        // frames so the room appends (and counts) each one.
        const serverSv = readVarUint8Array(decoder);
        const enc = createEncoder();
        writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(enc, doc, serverSv);
        ws.send(toUint8Array(enc));
        sendNext();
      } else if (syncType === SYNC_STEP2 || syncType === SYNC_UPDATE) {
        const update = readVarUint8Array(decoder);
        if (update.length > 0) Y.applyUpdate(doc, update, 'room');
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`compaction seed WebSocket error (sent ${next}/${mutations.length})`));
    };
  });
}
