/**
 * Seeds a board with sticky notes over a real WebSocket connection (Node's
 * built-in WebSocket, running in the Playwright test process). The whole board
 * is sent as a single Yjs update so the room stores (and compacts) it in one
 * shot — far faster than driving the browser to create each note.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeUint8, writeUint8Array } from 'lib0/encoding';
import { initDoc, createSticky } from '../../../src/shared/board-model';

const MESSAGE_SYNC = 0;

function sendSync(ws: WebSocket, enc: ReturnType<typeof createEncoder>): void {
  const frame = createEncoder();
  writeUint8(frame, MESSAGE_SYNC);
  writeUint8Array(frame, toUint8Array(enc));
  ws.send(toUint8Array(frame).slice().buffer as ArrayBuffer);
}

/**
 * Connect to a board and send `noteCount` sticky notes as one update.
 * @param httpUrl e.g. "http://localhost:27242"
 * @param boardId a valid 22-char board id
 * @param noteCount number of notes to create
 */
export async function seedBoard(httpUrl: string, boardId: string, noteCount: number): Promise<void> {
  const wsUrl = httpUrl.replace(/^http/, 'ws');
  const ws = new WebSocket(`${wsUrl}/api/rooms/${boardId}`);

  const doc = new Y.Doc();
  initDoc(doc);
  // Create the notes up front so the SyncStep2 we send (in reply to the
  // server's SyncStep1) already carries the full board state.
  for (let i = 0; i < noteCount; i++) {
    createSticky(doc, { x: (i % 50) * 220, y: Math.floor(i / 50) * 220 });
  }

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      // Push the full board state to the server as a sync Update (the server
      // applies it and stores it). A round-trip SyncStep1 confirms storage.
      const update = Y.encodeStateAsUpdate(doc);
      if (update.length > 0) {
        const encU = createEncoder();
        syncProtocol.writeUpdate(encU, update);
        sendSync(ws, encU);
      }
      const enc1 = createEncoder();
      syncProtocol.writeSyncStep1(enc1, doc);
      sendSync(ws, enc1);
      resolve();
    };
    ws.onerror = () => reject(new Error('seed: websocket connect error'));
    setTimeout(() => reject(new Error('seed: websocket connect timeout')), 15_000);
  });

  // The server does not need to respond (we pushed the full state). Give the
  // room a moment to append + compact before we disconnect.
  await new Promise((r) => setTimeout(r, 1500));
  ws.close();
}
