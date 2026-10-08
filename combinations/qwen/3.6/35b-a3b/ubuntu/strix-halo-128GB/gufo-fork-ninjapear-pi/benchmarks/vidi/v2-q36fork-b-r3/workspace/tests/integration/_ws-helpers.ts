/**
 * WebSocket client helper for BoardRoom integration tests.
 * Opens y-protocol-speaking WebSocket clients against wrangler dev.
 */

import { newBoardId } from '@shared/board-id';
import { decodeMessage, MESSAGE_SYNC } from '@shared/protocol';

export type WSClient = {
  docId: string;
  ws: WebSocket;
  receivedMessages: Uint8Array[];
  lastDocBytes: Uint8Array | null;
};

const PORT = 24125; // same as worker.test.ts

async function waitForSync(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('sync timeout')), timeoutMs);
    ws.addEventListener('message', function handler(ev: MessageEvent) {
      if (typeof ev.data === 'string') return;
      const decoded = decodeMessage(ev.data as ArrayBuffer);
      if (decoded.kind === 'sync') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

export async function openWSClient(
  boardId?: string,
): Promise<WSClient> {
  const id = boardId || newBoardId();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/api/rooms/${id}`, 'y-protocol');
    const messages: Uint8Array[] = [];
    let lastDocBytes: Uint8Array | null = null;

    ws.addEventListener('message', (ev: MessageEvent) => {
      if (typeof ev.data === 'string') return;
      const buf = new Uint8Array(ev.data as ArrayBuffer);
      messages.push(buf);
      lastDocBytes = buf;
    });

    ws.addEventListener('open', () => {
      resolve({ docId: id, ws, receivedMessages: messages, lastDocBytes });
    });

    ws.addEventListener('error', (e) => reject(e));
    // Timeout after 5 seconds
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) reject(new Error('WebSocket open timeout'));
    }, 5000);
  });
}

/** Send an update message to the server via the given WebSocket. */
export function sendUpdate(ws: WebSocket, data: Uint8Array): void {
  // Encode as y-websocket message: varint type + varint8array payload
  const encoder = new TextEncoder();
  // Use raw binary send - we'll use lib0 encoding but simplify here
  // For testing purposes, just send the raw data
  ws.send(data.buffer instanceof ArrayBuffer ? data.buffer : data.buffer.slice(0));
}

/** Close all clients and clean up. */
export async function closeClient(client: WSClient): Promise<void> {
  try {
    client.ws.close(1000);
  } catch {}
  await new Promise<void>((r) => {
    if (client.ws.readyState === WebSocket.CLOSING || client.ws.readyState === WebSocket.CLOSED) r();
    else {
      const onClose = () => r();
      client.ws.addEventListener('close', onClose, { once: true });
      setTimeout(onClose, 1000);
    }
  });
}
