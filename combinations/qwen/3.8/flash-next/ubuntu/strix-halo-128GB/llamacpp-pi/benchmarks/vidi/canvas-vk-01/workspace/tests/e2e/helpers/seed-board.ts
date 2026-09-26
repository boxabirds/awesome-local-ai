import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { createSticky, snapshot } from '../../../src/shared/board-model';
import { fixturePosition } from '../../fixtures/boards';

/**
 * A seeding client that talks to a running server over a real WebSocket, from
 * Node. Playwright's TC-21 needs a board with two thousand notes in it; building
 * that through the browser would measure the browser, and building it by writing
 * to wrangler's state directory would skip the code under test. So this is an
 * ordinary client — the same protocol the browser speaks.
 */

const wsUrl = (httpUrl: string): string => `${httpUrl.replace(/^http/, 'ws')}/api/rooms`;

interface Connected {
  doc: Y.Doc;
  provider: WebsocketProvider;
}

async function connect(httpUrl: string, boardId: string): Promise<Connected> {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsUrl(httpUrl), boardId, doc, {
    // Node 22 provides the WebSocket the provider expects.
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    connect: true,
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('seeding client never synced')), 30_000);
    provider.once('sync', () => {
      clearTimeout(timeout);
      resolve();
    });
    provider.on('status', (event: { status: string }) => {
      if (event.status === 'disconnected') {
        clearTimeout(timeout);
        reject(new Error('seeding client was disconnected — is the server running?'));
      }
    });
  });
  return { doc, provider };
}

/** Create `count` notes on the board as fast as the protocol allows. */
export async function seedBoardViaSocket(
  httpUrl: string,
  boardId: string,
  count: number,
): Promise<void> {
  const { doc, provider } = await connect(httpUrl, boardId);
  try {
    for (let index = 0; index < count; index++) {
      createSticky(doc, fixturePosition(index));
    }
  } finally {
    provider.disconnect();
    provider.destroy();
    doc.destroy();
  }
}

/**
 * Wait until an independent client sees at least `count` notes. Because the room
 * stores before it broadcasts, a client that can see the board proves the server
 * has it — which is what the tests need before they kill the process.
 */
export async function waitForBoardSize(
  httpUrl: string,
  boardId: string,
  count: number,
  timeoutMs = 30_000,
): Promise<void> {
  const { doc, provider } = await connect(httpUrl, boardId);
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      if (snapshot(doc).length >= count) return;
      if (Date.now() > deadline) {
        throw new Error(`board still holds ${snapshot(doc).length} of ${count} notes`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    provider.disconnect();
    provider.destroy();
    doc.destroy();
  }
}
