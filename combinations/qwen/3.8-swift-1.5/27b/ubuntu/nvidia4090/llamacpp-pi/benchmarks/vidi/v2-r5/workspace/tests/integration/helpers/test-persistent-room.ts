// tests/integration/helpers/test-persistent-room.ts
// Test harness for persistent BoardRoom that simulates the Durable Object context
// using mock storage and simulated WebSockets.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MESSAGE_SYNC, MESSAGE_AWARENESS, decodeMessage, CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE } from '../../../src/shared/protocol';
import { snapshot } from '../../../src/shared/board-model';
import { BoardStore, LOAD_ORIGIN } from '../../../src/worker/board-store';
import { MockDurableObjectStorage } from './mock-storage';

interface MockWebSocket {
  id: string;
  readyState: number; // 1 = OPEN, 3 = CLOSED
  sentMessages: { type: number; payload: Uint8Array }[];
  closeCode: number | null;
  closeReason: string | null;
  isClosed: boolean;
  send(data: ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

export class TestPersistentRoom {
  private storage: MockDurableObjectStorage;
  private sockets: MockWebSocket[] = [];
  private doc: Y.Doc | null = null;
  private store: BoardStore | null = null;
  private state: string = 'loading';

  constructor() {
    this.storage = new MockDurableObjectStorage();
    
    // Create the room
    // We'll simulate the BoardRoom constructor logic directly
    this.doc = new Y.Doc();
    this.store = new BoardStore(this.storage as any);
    this.store.migrate();
    
    const result = this.store.load(this.doc);
    if (result.ok) {
      this.state = 'ready';
      this.attachUpdateHandler();
    } else {
      this.state = 'load-failed';
      this.doc = null;
    }
  }

  private attachUpdateHandler(): void {
    if (!this.doc || !this.store) return;
    const self = this;
    const handler = (update: Uint8Array, origin: unknown) => {
      if (origin === LOAD_ORIGIN) return;
      if (!self.store) return;

      try {
        self.store.append(update);
      } catch (e) {
        self.handleStorageFailure();
        return;
      }

      self.broadcast(update, origin as any);
      self.store.compactIfNeeded(self.doc!);
    };
    this.doc.on('update', handler);
  }

  private handleStorageFailure(): void {
    this.state = 'storage-failed';
    for (const ws of this.sockets) {
      if (ws.readyState === 1) {
        ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      }
    }
    this.doc = null;
    this.store = null;
  }

  private createMockWebSocket(): MockWebSocket {
    const self = this;
    const ws: MockWebSocket = {
      id: `ws-${this.sockets.length + 1}`,
      readyState: 1,
      sentMessages: [],
      closeCode: null,
      closeReason: null,
      get isClosed() { return ws.readyState === 3; },
      send: (data: ArrayBuffer) => {
        if (ws.readyState !== 1) return;
        try {
          const uint8 = new Uint8Array(data);
          const decoder = decoding.createDecoder(uint8);
          const type = decoding.readVarUint(decoder);
          const len = decoding.readVarUint(decoder);
          const payload = decoding.readUint8Array(decoder, len);
          ws.sentMessages.push({ type, payload });
          // Process the message on the client side
          self.processClientMessage(ws);
        } catch { /* ignore */ }
      },
      close: (code?: number, reason?: string) => {
        if (ws.readyState === 3) return;
        ws.readyState = 3;
        ws.closeCode = code ?? 1000;
        ws.closeReason = reason ?? null;
      },
    };
    return ws;
  }

  private clientDocs: Map<MockWebSocket, Y.Doc> = new Map();
  private clientUpdateHandlers: Map<MockWebSocket, (update: Uint8Array, origin: unknown) => void> = new Map();

  private processClientMessage(ws: MockWebSocket): void {
    const doc = this.clientDocs.get(ws);
    if (!doc) return;

    for (const msg of ws.sentMessages) {
      if (msg.type !== MESSAGE_SYNC) continue;

      try {
        const decoder = decoding.createDecoder(msg.payload);
        const respEncoder = encoding.createEncoder();
        syncProtocol.readSyncMessage(decoder, respEncoder, doc, 'remote');

        const replyBytes = encoding.toUint8Array(respEncoder);
        if (replyBytes.length > 0) {
          const replyFrame = encoding.createEncoder();
          encoding.writeVarUint(replyFrame, MESSAGE_SYNC);
          encoding.writeVarUint(replyFrame, replyBytes.length);
          encoding.writeUint8Array(replyFrame, replyBytes);
          // Send reply to server
          this.handleServerMessage(ws, encoding.toUint8Array(replyFrame).buffer as ArrayBuffer);
        }
      } catch { /* ignore */ }
    }
  }

  acceptConnection(_clientId: string, existingDoc?: Y.Doc): { doc: Y.Doc; socket: MockWebSocket; snapshot: () => ReturnType<typeof snapshot>; waitForSync: () => Promise<void>; close: () => void } {
    const clientDoc = existingDoc ?? new Y.Doc();
    const ws = this.createMockWebSocket();
    this.sockets.push(ws);
    this.clientDocs.set(ws, clientDoc);

    let syncResolved = false;
    const syncPromise = new Promise<void>((resolve) => {
      const checkSync = () => {
        if (syncResolved) return;
        // Check if we've received a SyncStep2
        for (const msg of ws.sentMessages) {
          if (msg.type !== MESSAGE_SYNC) continue;
          try {
            const decoder = decoding.createDecoder(msg.payload);
            const t = decoding.readVarUint(decoder);
            if (t === syncProtocol.messageYjsSyncStep2) {
              syncResolved = true;
              resolve();
              return;
            }
          } catch { /* ignore */ }
        }
      };
      // Poll for sync completion
      const interval = setInterval(checkSync, 5);
      // Also check immediately
      checkSync();
      setTimeout(() => clearInterval(interval), 10000);
    });

    // Server sends SyncStep1 to client
    if (this.doc) {
      const inner = encoding.createEncoder();
      syncProtocol.writeSyncStep1(inner, this.doc);
      const innerBytes = encoding.toUint8Array(inner);
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_SYNC);
      encoding.writeVarUint(frame, innerBytes.length);
      encoding.writeUint8Array(frame, innerBytes);
      ws.send(encoding.toUint8Array(frame).buffer as ArrayBuffer);
    }

    // Client sends SyncStep1 to server
    const clientInner = encoding.createEncoder();
    syncProtocol.writeSyncStep1(clientInner, clientDoc);
    const clientInnerBytes = encoding.toUint8Array(clientInner);
    const clientFrame = encoding.createEncoder();
    encoding.writeVarUint(clientFrame, MESSAGE_SYNC);
    encoding.writeVarUint(clientFrame, clientInnerBytes.length);
    encoding.writeUint8Array(clientFrame, clientInnerBytes);
    this.handleServerMessage(ws, encoding.toUint8Array(clientFrame).buffer as ArrayBuffer);

    // Client-side: send local updates to server
    const clientUpdateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return;
      if (ws.readyState !== 1) return;
      const inner = encoding.createEncoder();
      syncProtocol.writeUpdate(inner, update);
      const innerBytes = encoding.toUint8Array(inner);
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_SYNC);
      encoding.writeVarUint(frame, innerBytes.length);
      encoding.writeUint8Array(frame, innerBytes);
      this.handleServerMessage(ws, encoding.toUint8Array(frame).buffer as ArrayBuffer);
    };
    clientDoc.on('update', clientUpdateHandler);
    this.clientUpdateHandlers.set(ws, clientUpdateHandler);

    return {
      doc: clientDoc,
      socket: ws,
      snapshot: () => snapshot(clientDoc),
      waitForSync: async () => {
        await syncPromise;
        await new Promise(r => setTimeout(r, 10));
      },
      close: () => {
        const handler = this.clientUpdateHandlers.get(ws);
        if (handler) clientDoc.off('update', handler);
        this.clientUpdateHandlers.delete(ws);
        this.clientDocs.delete(ws);
        ws.close(1000);
      },
    };
  }

  private handleServerMessage(ws: MockWebSocket, data: ArrayBuffer): void {
    if (ws.readyState !== 1) return;

    // Check room state
    if (this.state === 'load-failed') {
      ws.close(CLOSE_BOARD_LOAD_FAILED, 'board load failed');
      return;
    }

    if (this.state === 'storage-failed') {
      ws.close(CLOSE_STORAGE_FAILURE, 'storage failure');
      return;
    }

    if (!this.doc) return;

    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'sync') {
      this.handleSyncMessage(ws, decoded.payload);
    } else if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
    }
  }

  private handleSyncMessage(ws: MockWebSocket, payload: Uint8Array): void {
    if (!this.doc) return;

    try {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws, (err: Error) => { throw err; });

      const replyBytes = encoding.toUint8Array(encoder);
      if (replyBytes.length > 0) {
        const frame = encoding.createEncoder();
        encoding.writeVarUint(frame, MESSAGE_SYNC);
        encoding.writeVarUint(frame, replyBytes.length);
        encoding.writeUint8Array(frame, replyBytes);
        ws.send(encoding.toUint8Array(frame).buffer as ArrayBuffer);
      }
    } catch {
      ws.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  private broadcast(update: Uint8Array, except: unknown): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const innerBytes = encoding.toUint8Array(inner);

    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeVarUint(frame, innerBytes.length);
    encoding.writeUint8Array(frame, innerBytes);
    const buffer = encoding.toUint8Array(frame).buffer as ArrayBuffer;

    for (const socket of this.sockets) {
      if (socket === except) continue;
      if (socket.readyState !== 1) continue;
      try {
        socket.send(buffer);
      } catch { /* ignore */ }
    }
  }

  private relayAwareness(payload: Uint8Array): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_AWARENESS);
    encoding.writeVarUint(frame, payload.length);
    encoding.writeUint8Array(frame, payload);
    const buffer = encoding.toUint8Array(frame).buffer as ArrayBuffer;

    for (const socket of this.sockets) {
      if (socket.readyState !== 1) continue;
      try {
        socket.send(buffer);
      } catch { /* ignore */ }
    }
  }

  // ─── Test helpers ───────────────────────────────────────────────────────────

  get currentState(): string {
    return this.state;
  }

  get boardStore(): BoardStore | null {
    return this.store;
  }

  get document(): Y.Doc | null {
    return this.doc;
  }

  get mockStorage(): MockDurableObjectStorage {
    return this.storage;
  }

  /** Simulate a storage failure on next append */
  failNextAppend(): void {
    if (!this.store) return;
    const origAppend = this.store.append.bind(this.store);
    let failed = false;
    (this.store as any).append = (update: Uint8Array) => {
      if (!failed) {
        failed = true;
        (this.store as any).append = origAppend;
        throw new Error('Simulated storage failure');
      }
      origAppend(update);
    };
  }

  /** Corrupt the snapshot to simulate load failure */
  corruptSnapshot(): void {
    if (this.storage.sql.getSnapshotChunksCount() === 0) {
      // No snapshot yet - create one by compacting
      if (this.doc && this.store) {
        // Force compaction by setting counters
        const state = Y.encodeStateAsUpdate(this.doc);
        this.store.append(state);
        const dummy = new Uint8Array([1, 2, 3]);
        const { COMPACTION_UPDATE_COUNT } = require('../../../src/shared/config');
        for (let i = 1; i < COMPACTION_UPDATE_COUNT; i++) {
          this.store.append(dummy);
        }
        this.store.compactIfNeeded(this.doc);
      }
    }
    // Corrupt the first chunk
    const corrupted = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    this.storage.sql.snapshotChunks.set(0, corrupted);
  }

  /** Repair the snapshot (restore valid data) */
  repairSnapshot(): void {
    if (this.doc) {
      const state = Y.encodeStateAsUpdate(this.doc);
      const { chunkBytes } = require('../../../src/worker/board-store');
      const { SNAPSHOT_CHUNK_BYTES } = require('../../../src/shared/config');
      const chunks = chunkBytes(state, SNAPSHOT_CHUNK_BYTES);
      this.storage.sql.snapshotChunks.clear();
      for (let i = 0; i < chunks.length; i++) {
        this.storage.sql.snapshotChunks.set(i, chunks[i]);
      }
    }
  }

  /** Simulate a new room instance over the same storage (restart) */
  static reconstruct(storage: MockDurableObjectStorage): TestPersistentRoom {
    const room = new TestPersistentRoom();
    // Replace the storage with the provided one
    (room as any).storage = storage;
    // Reload
    room.doc = new Y.Doc();
    room.store = new BoardStore(storage as any);
    room.store.migrate();
    const result = room.store.load(room.doc);
    if (result.ok) {
      room.state = 'ready';
      room.attachUpdateHandler();
    } else {
      room.state = 'load-failed';
      room.doc = null;
    }
    return room;
  }

  /** Send a raw (potentially invalid) message to a socket */
  sendRawToSocket(ws: MockWebSocket, data: ArrayBuffer): void {
    this.handleServerMessage(ws, data);
  }

  destroy(): void {
    this.doc = null;
    this.store = null;
  }
}
