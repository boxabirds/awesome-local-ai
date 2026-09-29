import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoder from 'lib0/encoding';
import * as decoder from 'lib0/decoding';
import { decodeMessage, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC, MESSAGE_AWARENESS } from '../shared/protocol';
import { initDoc } from '../shared/board-model';

export class RoomCore {
  doc: Y.Doc | null = null;
  sockets = new Set<WorkersWebSocket>();

  handleConnect(server: WorkersWebSocket): void {
    this.sockets.add(server);

    if (this.doc === null) {
      this.doc = new Y.Doc();
      initDoc(this.doc);
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        this.broadcast(update, origin);
      });
    }

    this.sendSyncStep1(server);

    server.onmessage = (event: MessageEvent) => {
      this.handleMessage(server, event.data as ArrayBuffer | string);
    };

    server.onclose = () => {
      this.sockets.delete(server);
    };

    server.onerror = () => {
      this.sockets.delete(server);
    };
  }

  private wrapSync(innerBytes: Uint8Array): Uint8Array {
    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, MESSAGE_SYNC);
    encoder.writeVarUint8Array(frame, innerBytes);
    return encoder.toUint8Array(frame);
  }

  private sendSyncStep1(ws: WorkersWebSocket): void {
    if (!this.doc) return;
    const inner = encoder.createEncoder();
    syncProtocol.writeSyncStep1(inner, this.doc);
    ws.send(this.wrapSync(encoder.toUint8Array(inner)));
  }

  private handleMessage(ws: WorkersWebSocket, data: ArrayBuffer | string): void {
    const decoded = decodeMessage(data);

    if (decoded.kind === 'invalid') {
      ws.close(CLOSE_UNSUPPORTED_DATA);
      return;
    }

    if (decoded.kind === 'query-awareness') {
      return;
    }

    if (decoded.kind === 'sync') {
      if (!this.doc) return;
      try {
        const dec = decoder.createDecoder(decoded.payload);
        const res = encoder.createEncoder();
        syncProtocol.readSyncMessage(dec, res, this.doc, ws);
        if (encoder.hasContent(res)) {
          ws.send(this.wrapSync(encoder.toUint8Array(res)));
        }
      } catch (e) {
        ws.close(CLOSE_UNSUPPORTED_DATA);
      }
      return;
    }

    if (decoded.kind === 'awareness') {
      const frame = encoder.createEncoder();
      encoder.writeVarInt(frame, MESSAGE_AWARENESS);
      encoder.writeVarUint8Array(frame, decoded.payload);
      const bytes = encoder.toUint8Array(frame);
      for (const socket of this.sockets) {
        try {
          socket.send(bytes);
        } catch {
          this.sockets.delete(socket);
        }
      }
      return;
    }
  }

  private broadcast(update: Uint8Array, origin: unknown): void {
    const inner = encoder.createEncoder();
    syncProtocol.writeUpdate(inner, update);
    const bytes = this.wrapSync(encoder.toUint8Array(inner));
    for (const socket of this.sockets) {
      if (socket === origin) continue;
      try {
        socket.send(bytes);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }
}
