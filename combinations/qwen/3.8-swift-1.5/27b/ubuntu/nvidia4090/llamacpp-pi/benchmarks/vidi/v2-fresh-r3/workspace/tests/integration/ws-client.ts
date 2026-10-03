/**
 * WebSocket test client using y-websocket's WebsocketProvider.
 * Connects to a real board server and speaks the y-websocket protocol.
 */
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as sync from 'y-protocols/sync';
import { createEncoder, toUint8Array } from 'lib0/encoding';
import { createDecoder } from 'lib0/decoding';
import { initDoc, type StickySnapshot } from '../../src/shared/board-model';

declare const process: { env: Record<string, string | undefined> };

const SERVER_URL = `ws://127.0.0.1:${process.env.INTEGRATION_PORT || '23030'}`;

/**
 * A test client that connects to a real board server via y-websocket WebsocketProvider.
 */
export class TestClient {
  doc: Y.Doc;
  provider: WebsocketProvider;
  private awareStates: Uint8Array[] = [];

  private constructor(doc: Y.Doc, provider: WebsocketProvider) {
    this.doc = doc;
    this.provider = provider;
  }

  /** Connect to a board via WebSocket. Returns a connected TestClient. */
  static async connect(boardId: string): Promise<TestClient> {
    const doc = new Y.Doc();
    initDoc(doc);
    // WebsocketProvider connects to `${url}/${room}`
    const provider = new WebsocketProvider(`${SERVER_URL}/api/rooms`, boardId, doc);
    return new TestClient(doc, provider);
  }

  /** Wait for the provider to connect and sync. */
  async waitForSync(timeout = 10000): Promise<void> {
    if (this.provider.synced) return;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sync timeout')), timeout);
      const handler = () => {
        if (this.provider.synced) {
          clearTimeout(timer);
          resolve();
        }
      };
      this.provider.on('sync', handler);
      // Also poll in case we miss the event
      const pollInterval = setInterval(() => {
        if (this.provider.synced) {
          clearTimeout(timer);
          clearInterval(pollInterval);
          resolve();
        }
      }, 50);
    });
  }

  /** Get a snapshot of the board notes. */
  snapshot(): readonly StickySnapshot[] {
    const objects = this.doc.getMap('objects');
    const result: StickySnapshot[] = [];
    objects.forEach((obj: unknown, id: string) => {
      const m = obj as Y.Map<unknown>;
      const text = m.get('text');
      result.push({
        id,
        type: m.get('type') as StickySnapshot['type'],
        x: m.get('x') as number,
        y: m.get('y') as number,
        color: m.get('color') as StickySnapshot['color'],
        text: text instanceof Y.Text ? text.toString() : '',
        z: m.get('z') as number,
        createdAt: m.get('createdAt') as number,
      });
    });
    return result;
  }

  /** Get objects as a plain record for comparison. */
  objectsSnapshot(): Record<string, unknown> {
    const objects = this.doc.getMap('objects');
    const result: Record<string, unknown> = {};
    objects.forEach((obj: unknown, id: string) => {
      const m = obj as Y.Map<unknown>;
      const text = m.get('text');
      result[id] = {
        type: m.get('type'),
        x: m.get('x'),
        y: m.get('y'),
        color: m.get('color'),
        text: text instanceof Y.Text ? text.toString() : '',
        z: m.get('z'),
        createdAt: m.get('createdAt'),
      };
    });
    return result;
  }

  get synced(): boolean {
    return this.provider.synced;
  }

  get connected(): boolean {
    return (this.provider as any).ws != null;
  }

  close(): void {
    this.provider.destroy();
  }

  abruptClose(): void {
    this.provider.destroy();
  }

  sendRaw(_data: Uint8Array | string): void {
    throw new Error('sendRaw not supported with WebsocketProvider - use RawTestClient');
  }

  sendAwareness(payload: Uint8Array): void {
    // Use the provider's awareness API
    const awareness = (this.provider as any).awareness;
    if (awareness) {
      awareness.setLocalState({ data: payload });
    }
  }

  /** Get the awareness state received from other clients. */
  getAwarenessStates(): Map<number, unknown> {
    const awareness = (this.provider as any).awareness;
    if (!awareness) return new Map();
    const states = new Map<number, unknown>();
    awareness.getStates().forEach((state: unknown, clientId: number) => {
      if (clientId !== awareness.clientID) {
        states.set(clientId, state);
      }
    });
    return states;
  }

  getMessages(): { type: number; data: Uint8Array }[] {
    return [];
  }

  get isOpen(): boolean {
    const ws = (this.provider as any).ws;
    return ws != null && ws.readyState === 1;
  }

  waitForClose(timeout = 5000): Promise<number> {
    const ws = (this.provider as any).ws;
    if (!ws) return Promise.resolve(0);
    if (ws.readyState === 3) return Promise.resolve(ws.closeCode || 0);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(ws.closeCode || 0), timeout);
      ws.onclose = (event: CloseEvent) => {
        clearTimeout(timer);
        resolve(event.code);
      };
    });
  }

  onMessage(_listener: (type: number, data: Uint8Array) => void): () => void {
    return () => {};
  }

  waitForMessage(_type: number, _timeout = 5000): Promise<Uint8Array> {
    return new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('waitForMessage not supported')), _timeout);
    });
  }

  get syncMessageCount(): number {
    return 0;
  }

  get awarenessMessageCount(): number {
    return this.awareStates.length;
  }
}

/**
 * A raw WebSocket test client for testing malformed traffic.
 * Does NOT use WebsocketProvider - speaks the protocol manually.
 */
export class RawTestClient {
  doc: Y.Doc;
  private ws: WebSocket;
  private closeResolver: ((code: number) => void) | null = null;
  private _isOpen = false;

  private constructor(ws: WebSocket) {
    this.doc = new Y.Doc();
    initDoc(this.doc);
    this.ws = ws;
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => { this._isOpen = true; };
    this.ws.onclose = (event: CloseEvent) => {
      this._isOpen = false;
      this.closeCode = event.code;
      if (this.closeResolver) {
        this.closeResolver(event.code);
        this.closeResolver = null;
      }
    };
    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data as ArrayBuffer);
    };

    // Send local updates to server
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      const encoder = createEncoder();
      sync.writeUpdate(encoder, update);
      const payload = toUint8Array(encoder);
      const frame = new Uint8Array(1 + payload.length);
      frame[0] = 0; // MESSAGE_SYNC
      frame.set(payload, 1);
      if (this.ws.readyState === 1) this.ws.send(frame);
    });
  }

  static async connect(boardId: string): Promise<RawTestClient> {
    const ws = new WebSocket(`${SERVER_URL}/api/rooms/${boardId}`);
    ws.binaryType = 'arraybuffer';
    const client = new RawTestClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });
    return client;
  }

  private handleMessage(data: ArrayBuffer): void {
    const bytes = new Uint8Array(data);
    if (bytes.length < 1 || bytes[0] !== 0) return;
    const payload = bytes.slice(1);
    try {
      const decoder = createDecoder(payload);
      const replyEncoder = createEncoder();
      sync.readSyncMessage(decoder, replyEncoder, this.doc, 'remote');
      const reply = toUint8Array(replyEncoder);
      if (reply.length > 0 && this.ws.readyState === 1) {
        const frame = new Uint8Array(1 + reply.length);
        frame[0] = 0;
        frame.set(reply, 1);
        this.ws.send(frame);
      }
    } catch { /* ignore */ }
  }

  async waitForSync(_timeout = 10000): Promise<void> {
    // Wait a bit for the initial sync to complete
    await new Promise(r => setTimeout(r, 500));
  }

  objectsSnapshot(): Record<string, unknown> {
    const objects = this.doc.getMap('objects');
    const result: Record<string, unknown> = {};
    objects.forEach((obj: unknown, id: string) => {
      const m = obj as Y.Map<unknown>;
      const text = m.get('text');
      result[id] = {
        type: m.get('type'),
        x: m.get('x'),
        y: m.get('y'),
        color: m.get('color'),
        text: text instanceof Y.Text ? text.toString() : '',
        z: m.get('z'),
        createdAt: m.get('createdAt'),
      };
    });
    return result;
  }

  private closeCode = 0;

  get isOpen(): boolean {
    return this._isOpen && this.ws.readyState === 1;
  }

  sendRaw(data: Uint8Array | string): void {
    if (this.ws.readyState === 1) this.ws.send(data);
  }

  waitForClose(timeout = 5000): Promise<number> {
    if (this.ws.readyState === 3) return Promise.resolve(this.closeCode);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.closeCode), timeout);
      this.closeResolver = (code: number) => {
        this.closeCode = code;
        clearTimeout(timer);
        resolve(code);
      };
    });
  }

  close(): void {
    this.ws.close(1000, 'done');
  }

  abruptClose(): void {
    this.ws.close(1000, 'abrupt');
  }
}
