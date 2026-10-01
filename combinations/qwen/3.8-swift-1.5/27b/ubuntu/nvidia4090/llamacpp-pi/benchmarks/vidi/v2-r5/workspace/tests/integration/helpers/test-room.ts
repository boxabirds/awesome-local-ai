// tests/integration/helpers/test-room.ts
// Test harness for BoardRoom that creates real Y.Doc instances and simulates
// WebSocket connections using the same y-protocols framing as the real server.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MESSAGE_SYNC, MESSAGE_AWARENESS, decodeMessage, CLOSE_UNSUPPORTED_DATA } from '../../../src/shared/protocol';
import { snapshot } from '../../../src/shared/board-model';

interface TestSocket {
  id: string;
  readyState: number; // 1 = OPEN, 3 = CLOSED
  /** Messages sent FROM server TO this client */
  receivedFromServer: { type: number; payload: Uint8Array; _processed?: boolean }[];
  closeCode: number | null;
  /** Called by the harness when client sends data to server */
  clientSend: (data: ArrayBuffer) => void;
  /** Called by the harness when server sends data to client */
  serverSend: (data: ArrayBuffer) => void;
  close(code?: number): void;
  isClosed: boolean;
}

export interface TestClient {
  doc: Y.Doc;
  socket: TestSocket;
  snapshot: () => ReturnType<typeof snapshot>;
  /** Number of sync messages received from server */
  getSyncCount: () => number;
  waitForSync: () => Promise<void>;
  /** Temporarily stop sending updates to server (for concurrency tests) */
  freeze: () => void;
  /** Resume sending and flush pending updates */
  unfreeze: () => void;
  close: () => void;
}

export class TestRoom {
  private sockets: Set<TestSocket> = new Set();
  private doc: Y.Doc;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  constructor() {
    this.doc = new Y.Doc();
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      this.broadcast(update, origin as TestSocket | null);
    };
    this.doc.on('update', this.updateHandler);
  }

  get document(): Y.Doc {
    return this.doc;
  }

  acceptConnection(id: string): TestClient {
    const clientDoc = new Y.Doc();
    let syncResolver: (() => void) | null = null;
    const syncPromise = new Promise<void>((resolve) => { syncResolver = resolve; });
    let syncDone = false;

    // Define the client-side message processor first
    const processClientMessages = (socket: TestSocket) => {
      for (let i = 0; i < socket.receivedFromServer.length; i++) {
        const msg = socket.receivedFromServer[i];
        if (msg._processed) continue;
        msg._processed = true;

        if (msg.type !== MESSAGE_SYNC) continue;

        try {
          const decoder = decoding.createDecoder(msg.payload);
          const respEncoder = encoding.createEncoder();
          syncProtocol.readSyncMessage(decoder, respEncoder, clientDoc, 'remote');

          const replyBytes = encoding.toUint8Array(respEncoder);
          if (replyBytes.length > 0) {
            const replyFrame = encoding.createEncoder();
            encoding.writeVarUint(replyFrame, MESSAGE_SYNC);
            encoding.writeVarUint(replyFrame, replyBytes.length);
            encoding.writeUint8Array(replyFrame, replyBytes);
            socket.clientSend(encoding.toUint8Array(replyFrame).buffer as ArrayBuffer);
          }

          // Check if we received a SyncStep2 (sync complete)
          const typeDecoder = decoding.createDecoder(msg.payload);
          const t = decoding.readVarUint(typeDecoder);
          if (t === syncProtocol.messageYjsSyncStep2 && !syncDone) {
            syncDone = true;
            if (syncResolver) {
              syncResolver();
              syncResolver = null;
            }
          }
        } catch { /* ignore */ }
      }
    };

    const socket: TestSocket = {
      id,
      readyState: 1,
      receivedFromServer: [],
      closeCode: null,
      clientSend: (data: ArrayBuffer) => {
        this.handleClientMessage(socket, data);
      },
      serverSend: (data: ArrayBuffer) => {
        if (socket.readyState !== 1) return;
        try {
          const uint8 = new Uint8Array(data);
          const decoder = decoding.createDecoder(uint8);
          const type = decoding.readVarUint(decoder);
          const len = decoding.readVarUint(decoder);
          const payload = decoding.readUint8Array(decoder, len);
          socket.receivedFromServer.push({ type, payload });
          // Trigger client-side processing
          processClientMessages(socket);
        } catch { /* ignore */ }
      },
      close: (code?: number) => {
        if (socket.readyState === 3) return;
        socket.readyState = 3;
        socket.closeCode = code ?? 1000;
        this.sockets.delete(socket);
      },
      get isClosed() { return socket.readyState === 3; },
    };

    this.sockets.add(socket);

    // Server sends SyncStep1 to client (triggers client processing)
    this.sendServerSyncStep1(socket);

    // Client sends SyncStep1 to server (triggers server processing)
    const clientInner = encoding.createEncoder();
    syncProtocol.writeSyncStep1(clientInner, clientDoc);
    const clientInnerBytes = encoding.toUint8Array(clientInner);
    const clientFrame = encoding.createEncoder();
    encoding.writeVarUint(clientFrame, MESSAGE_SYNC);
    encoding.writeVarUint(clientFrame, clientInnerBytes.length);
    encoding.writeUint8Array(clientFrame, clientInnerBytes);
    socket.clientSend(encoding.toUint8Array(clientFrame).buffer as ArrayBuffer);

    // Client-side: send local updates to server (like y-websocket provider)
    let propagationEnabled = true;
    const clientUpdateHandler = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote') return; // Don't echo back remote updates
      if (!propagationEnabled) return;
      if (socket.readyState !== 1) return;
      const inner = encoding.createEncoder();
      syncProtocol.writeUpdate(inner, update);
      const innerBytes = encoding.toUint8Array(inner);
      const frame = encoding.createEncoder();
      encoding.writeVarUint(frame, MESSAGE_SYNC);
      encoding.writeVarUint(frame, innerBytes.length);
      encoding.writeUint8Array(frame, innerBytes);
      socket.clientSend(encoding.toUint8Array(frame).buffer as ArrayBuffer);
    };
    clientDoc.on('update', clientUpdateHandler);

    return {
      doc: clientDoc,
      socket,
      snapshot: () => snapshot(clientDoc),
      getSyncCount: () => socket.receivedFromServer.filter(m => m.type === MESSAGE_SYNC).length,
      waitForSync: async () => {
        await syncPromise;
        await new Promise(r => setTimeout(r, 10));
      },
      /** Temporarily stop sending updates to server (for concurrency tests) */
      freeze: () => { propagationEnabled = false; },
      /** Resume sending and flush pending updates */
      unfreeze: () => {
        propagationEnabled = true;
        // Send current state as an update
        if (socket.readyState !== 1) return;
        const state = Y.encodeStateAsUpdate(clientDoc);
        if (state.length > 0) {
          const inner = encoding.createEncoder();
          syncProtocol.writeUpdate(inner, state);
          const innerBytes = encoding.toUint8Array(inner);
          const frame = encoding.createEncoder();
          encoding.writeVarUint(frame, MESSAGE_SYNC);
          encoding.writeVarUint(frame, innerBytes.length);
          encoding.writeUint8Array(frame, innerBytes);
          socket.clientSend(encoding.toUint8Array(frame).buffer as ArrayBuffer);
        }
      },
      close: () => {
        clientDoc.off('update', clientUpdateHandler);
        socket.close();
      },
    };
  }

  private handleClientMessage(socket: TestSocket, data: ArrayBuffer): void {
    if (socket.readyState !== 1) return;

    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      socket.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'sync') {
      this.handleSyncMessage(socket, decoded.payload);
    } else if (decoded.kind === 'awareness') {
      this.relayAwareness(decoded.payload);
    }
  }

  private sendServerSyncStep1(socket: TestSocket): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeSyncStep1(inner, this.doc);
    const innerBytes = encoding.toUint8Array(inner);

    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeVarUint(frame, innerBytes.length);
    encoding.writeUint8Array(frame, innerBytes);
    socket.serverSend(encoding.toUint8Array(frame).buffer as ArrayBuffer);
  }

  private handleSyncMessage(socket: TestSocket, payload: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(payload);
      const encoder = encoding.createEncoder();
      // Pass an errorHandler that throws so we can catch invalid updates
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket, (err: Error) => { throw err; });

      const replyBytes = encoding.toUint8Array(encoder);
      if (replyBytes.length > 0) {
        const frame = encoding.createEncoder();
        encoding.writeVarUint(frame, MESSAGE_SYNC);
        encoding.writeVarUint(frame, replyBytes.length);
        encoding.writeUint8Array(frame, replyBytes);
        socket.serverSend(encoding.toUint8Array(frame).buffer as ArrayBuffer);
      }
    } catch {
      socket.close(CLOSE_UNSUPPORTED_DATA);
    }
  }

  private broadcast(update: Uint8Array, except: TestSocket | null): void {
    const inner = encoding.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const innerBytes = encoding.toUint8Array(inner);

    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_SYNC);
    encoding.writeVarUint(frame, innerBytes.length);
    encoding.writeUint8Array(frame, innerBytes);
    const bytes = encoding.toUint8Array(frame);
    const buffer = bytes.buffer as ArrayBuffer;

    for (const socket of this.sockets) {
      if (socket === except) continue;
      if (socket.readyState !== 1) continue;
      try {
        socket.serverSend(buffer);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private relayAwareness(payload: Uint8Array): void {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_AWARENESS);
    encoding.writeVarUint(frame, payload.length);
    encoding.writeUint8Array(frame, payload);
    const bytes = encoding.toUint8Array(frame);
    const buffer = bytes.buffer as ArrayBuffer;

    for (const socket of this.sockets) {
      if (socket.readyState !== 1) continue;
      try {
        socket.serverSend(buffer);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  // Send a raw frame to the server as if from a specific client socket
  sendRawToSocket(socket: TestSocket, data: ArrayBuffer): void {
    this.handleClientMessage(socket, data);
  }

  // Simulate a text frame (for malformed traffic tests)
  sendTextToSocket(socket: TestSocket, text: string): void {
    this.handleClientMessage(socket, text as any);
  }

  destroy(): void {
    if (this.updateHandler) {
      this.doc.off('update', this.updateHandler);
    }
    this.doc.destroy();
  }
}
