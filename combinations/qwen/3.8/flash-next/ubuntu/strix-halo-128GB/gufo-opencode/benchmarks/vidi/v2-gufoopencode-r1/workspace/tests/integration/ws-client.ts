import * as Y from 'yjs';
import WebSocket from 'ws';
import { WebsocketProvider } from 'y-websocket';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { MESSAGE_AWARENESS, MESSAGE_SYNC, decodeMessage } from '../../src/shared/protocol';

type ProviderOptions = NonNullable<ConstructorParameters<typeof WebsocketProvider>[3]>;

export interface ClientLog {
  // y-protocols message kinds received on the wire (sync step1/step2/update).
  syncKinds: number[];
  // Raw awareness frame bodies, in arrival order.
  awareness: Uint8Array[];
  // Close codes seen on the socket (1006 abrupt, provider-initiated, etc.).
  closes: number[];
}

// A test participant: a real Y.Doc plus a real WebsocketProvider pointed at
// the running Worker. `disableBc` is essential — without it two providers in
// this single Node process would sync through BroadcastChannel and the test
// could pass without the server ever seeing a byte. `ws` is passed as the
// polyfill so no HTTP proxy in the environment can intercept the upgrade.
export class TestClient {
  readonly doc = new Y.Doc();
  readonly provider: WebsocketProvider;
  readonly log: ClientLog = { syncKinds: [], awareness: [], closes: [] };

  private constructor(port: number, boardId: string) {
    initDoc(this.doc);
    this.provider = new WebsocketProvider(`ws://127.0.0.1:${port}/api/rooms`, boardId, this.doc, {
      WebSocketPolyfill: WebSocket as unknown as ProviderOptions['WebSocketPolyfill'],
      disableBc: true
    });
    this.provider.on('connection-close', (event) => {
      this.log.closes.push(event?.code ?? -1);
    });
  }

  static async connected(port: number, boardId: string): Promise<TestClient> {
    const client = new TestClient(port, boardId);
    await waitFor(() => client.provider.wsconnected, 'socket open', boardId);
    // Hook the live socket to record every inbound frame kind, exactly as the
    // browser provider would see it.
    client.provider.ws?.addEventListener('message', (event: MessageEvent) => {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      const decoded = decodeMessage(bytes.buffer as ArrayBuffer);
      if (decoded.kind === 'sync') {
        const body = decoded.payload;
        client.log.syncKinds.push(body[0] ?? -1);
      } else if (decoded.kind === 'awareness') {
        client.log.awareness.push(decoded.payload);
      }
    });
    await waitFor(() => client.provider.synced, 'initial sync', boardId);
    return client;
  }

  // Waits until a frame other than the initial exchange arrives; `since` is
  // the log length taken before the change was made.
  async waitForNewFrames(since: number, what: string, timeout = 10_000): Promise<void> {
    await waitFor(
      () => this.log.syncKinds.length + this.log.awareness.length > since,
      `frames for ${what}`,
      '',
      timeout
    );
  }

  framesSince(since: number): number[] {
    return this.log.syncKinds.slice(since);
  }

  boardSnapshot(): string {
    return JSON.stringify(snapshot(this.doc));
  }

  async close(): Promise<void> {
    this.provider.disconnect();
    this.provider.destroy();
    this.doc.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function rawSocket(port: number, boardId: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/api/rooms/${boardId}`);
}

export function waitForSync(client: TestClient): Promise<void> {
  return waitFor(() => client.provider.synced, 'sync', '');
}

export async function waitFor(
  condition: () => boolean,
  what: string,
  context = '',
  timeout = 15_000
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what} ${context}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

export { MESSAGE_AWARENESS, MESSAGE_SYNC };
