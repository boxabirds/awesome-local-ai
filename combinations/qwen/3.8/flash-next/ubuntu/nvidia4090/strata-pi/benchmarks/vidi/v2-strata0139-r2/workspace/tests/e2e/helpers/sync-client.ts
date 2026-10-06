import * as Y from "yjs";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import { snapshot } from "../../../src/shared/board-model";
import { MESSAGE_SYNC } from "../../../src/shared/protocol";

/**
 * Story 4 e2e helper: a sync client that runs in the test process instead of a
 * browser.
 *
 * `tests/fixtures/boards.ts` builds boards with the real board-model functions,
 * and this speaks the same protocol the browser client speaks: `MESSAGE_SYNC`
 * frames carrying y-protocols sync bodies. It exists because a 2,000-note board
 * (TC-21) cannot be built by 2,000 pointer gestures in a browser within any
 * sane test time — the notes are *read* from the rendered page, they are only
 * written through the protocol.
 */

export interface SyncClient {
  readonly doc: Y.Doc;
  readonly url: string;
  readonly closed: Promise<{ code: number; reason: string }>;
  sendUpdate(update: Uint8Array): void;
  requestSync(): void;
  close(): void;
}

/** Opens a board socket in Node and resolves once it is open. */
export async function openSyncClient(port: number, boardId: string): Promise<SyncClient> {
  const url = `ws://127.0.0.1:${port}/api/rooms/${boardId}`;
  const doc = new Y.Doc();
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    socket.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
  });
  const failed = new Promise<never>((_, reject) => {
    socket.addEventListener("error", () => reject(new Error(`sync client could not reach ${url}`)));
  });
  await Promise.race([
    new Promise<void>((resolve) => socket.addEventListener("open", resolve)),
    failed,
  ]);

  const send = (write: (encoder: encoding.Encoder) => void) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    write(encoder);
    socket.send(encoding.toUint8Array(encoder));
  };

  const client: SyncClient = {
    doc,
    url,
    closed,
    sendUpdate: (update) => {
      send((encoder) => syncProtocol.writeUpdate(encoder, update));
    },
    requestSync: () => {
      send((encoder) => syncProtocol.writeSyncStep1(encoder, doc));
    },
    close: () => socket.close(),
  };

  socket.addEventListener("message", (event) => {
    const bytes = new Uint8Array(event.data as ArrayBuffer);
    const decoder = decoding.createDecoder(bytes);
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return;
    const encoder = encoding.createEncoder();
    const replyType = syncProtocol.readSyncMessage(decoder, encoder, doc, "remote");
    // A SyncStep1 asks for our state; anything else is already applied.
    if (replyType === 0 && encoding.length(encoder) > 1) {
      socket.send(encoding.toUint8Array(encoder));
    }
  });

  return client;
}

/**
 * Sends every update of a fixture board to the room, one frame each — the same
 * shape a person's edits arrive in, which is what lets the room's compaction
 * thresholds be reached from an e2e test.
 */
export async function seedBoard(
  port: number,
  boardId: string,
  updates: readonly Uint8Array[],
): Promise<void> {
  const client = await openSyncClient(port, boardId);
  try {
    for (const update of updates) client.sendUpdate(update);
  } finally {
    client.close();
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

/**
 * Reads the room's board back through a fresh socket and returns how many notes
 * the room has, waiting for `expected` of them when one is given.
 *
 * Used to confirm a seeded board really reached the room before the browser — or
 * the process restart — gets there. The room stores every update it is sent, one
 * SQLite transaction each, so a large board takes time to arrive; waiting for the
 * count is what makes the following assertion mean something.
 */
export async function readBoardNoteCount(
  port: number,
  boardId: string,
  expected?: number,
  timeoutMs = 60_000,
): Promise<number> {
  const client = await openSyncClient(port, boardId);
  client.requestSync();
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      const notes = snapshot(client.doc).length;
      if (expected === undefined ? notes > 0 : notes >= expected) return notes;
      if (Date.now() > deadline) return notes;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    client.close();
  }
}
