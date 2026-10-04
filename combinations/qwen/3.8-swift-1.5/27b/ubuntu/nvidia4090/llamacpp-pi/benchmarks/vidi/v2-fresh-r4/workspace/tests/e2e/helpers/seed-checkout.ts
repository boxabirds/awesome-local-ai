/**
 * Seeds a board with the checkout-flow fixture over a real WebSocket
 * connection (Node's built-in WebSocket, running in the Playwright test
 * process). The whole board is sent as a single Yjs update — the same
 * approach as `seed-board.ts`.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import { createEncoder, toUint8Array, writeUint8, writeUint8Array } from 'lib0/encoding';
import { seedCheckoutFlow, type CheckoutFlowIds } from '../../fixtures/checkout-flow';

const MESSAGE_SYNC = 0;

function sendSync(ws: WebSocket, enc: ReturnType<typeof createEncoder>): void {
  const frame = createEncoder();
  writeUint8(frame, MESSAGE_SYNC);
  writeUint8Array(frame, toUint8Array(enc));
  ws.send(toUint8Array(frame).slice().buffer as ArrayBuffer);
}

/**
 * Connect to a board and push the checkout-flow fixture as one update.
 * @param httpUrl e.g. "http://localhost:27240"
 * @param boardId a valid 22-char board id
 * @returns the ids of the seeded objects
 */
export async function seedCheckoutFlowToBoard(
  httpUrl: string,
  boardId: string,
): Promise<CheckoutFlowIds> {
  const wsUrl = httpUrl.replace(/^http/, 'ws');
  const ws = new WebSocket(`${wsUrl}/api/rooms/${boardId}`);

  const doc = new Y.Doc();
  const ids = seedCheckoutFlow(doc);

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
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
    ws.onerror = () => reject(new Error('seed-checkout: websocket connect error'));
    setTimeout(() => reject(new Error('seed-checkout: websocket connect timeout')), 15_000);
  });

  // Give the room a moment to append + compact before we disconnect.
  await new Promise((r) => setTimeout(r, 1500));
  ws.close();
  return ids;
}
