// Test helper: Node.js WebSocket client for board sync E2E tests.
// Connects to the Vite dev server's /api/rooms/:boardId WebSocket endpoint
// and implements the y-protocols sync protocol.

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as sync from 'y-protocols/sync';
import * as awareness from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const BASE = 'ws://127.0.0.1:28432';
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

export class TestSyncClient {
  ws: WebSocket | null = null;
  doc: Y.Doc;
  awareness: awareness.Awareness;
  private connected: Promise<void>;
  private resolveConnected: (() => void) | null = null;
  private synced: Promise<void>;
  private resolveSynced: (() => void) | null = null;
  private isSynced = false;

  constructor(public boardId: string) {
    this.doc = new Y.Doc();
    this.awareness = new awareness.Awareness(this.doc);
    this.connected = new Promise((r) => { this.resolveConnected = r; });
    this.synced = new Promise((r) => { this.resolveSynced = r; });
  }

  connect(): this {
    this.ws = new WebSocket(`${BASE}/api/rooms/${this.boardId}`);
    this.ws.binaryType = 'arraybuffer';

    this.ws.on('open', () => {
      this.resolveConnected?.();
      // Send SyncStep1
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      sync.writeSyncStep1(enc, this.doc);
      this.ws!.send(encoding.toUint8Array(enc));
      // Send query awareness
      const enc2 = encoding.createEncoder();
      encoding.writeVarUint(enc2, MESSAGE_QUERY_AWARENESS);
      this.ws!.send(encoding.toUint8Array(enc2));
    });

    this.ws.on('message', (data: ArrayBuffer) => {
      this.handleMessage(new Uint8Array(data));
    });

    this.ws.on('close', () => {
      // Connection closed
    });

    return this;
  }

  private handleMessage(bytes: Uint8Array): void {
    const decoder = decoding.createDecoder(bytes);
    const kind = decoding.readVarUint(decoder);

    if (kind === MESSAGE_SYNC) {
      const subType = decoding.readVarUint(decoder);
      if (subType === 0) {
        // SyncStep1 from server
        const stateVector = decoding.readVarUint8Array(decoder);
        const update = Y.encodeStateAsUpdate(this.doc, stateVector);
        if (update.length > 0) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          sync.writeSyncStep2(enc, this.doc, stateVector);
          this.ws?.send(encoding.toUint8Array(enc));
        }
      } else if (subType === 1) {
        // SyncStep2 from server
        const update = decoding.readVarUint8Array(decoder);
        Y.applyUpdate(this.doc, update, this);
        if (!this.isSynced) {
          // Check if we've also sent our state
          this.maybeMarkSynced();
        }
      } else if (subType === 2) {
        // Update from server
        const update = decoding.readVarUint8Array(decoder);
        Y.applyUpdate(this.doc, update, this);
      }
    } else if (kind === MESSAGE_AWARENESS) {
      const payload = decoding.readVarUint8Array(decoder);
      awareness.applyAwarenessUpdate(this.awareness, payload, 'remote');
    }
  }

  private maybeMarkSynced(): void {
    // Simplified: consider synced after receiving SyncStep2
    this.isSynced = true;
    this.resolveSynced?.();
  }

  async waitForConnected(timeoutMs = 10000): Promise<void> {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('connection timeout')), timeoutMs));
    await Promise.race([this.connected, timeout]);
  }

  async waitForSync(timeoutMs = 10000): Promise<void> {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('sync timeout')), timeoutMs));
    await Promise.race([this.synced, timeout]);
  }

  createSticky(): string {
    const id = crypto.randomUUID();
    const note = new Y.Map();
    note.set('id', id);
    note.set('type', 'sticky');
    note.set('x', Math.random() * 400);
    note.set('y', Math.random() * 300);
    note.set('width', 180);
    note.set('height', 180);
    const text = new Y.Text();
    note.set('text', text);
    // Capture the update from the transaction
    let capturedUpdate: Uint8Array | null = null;
    const handler = (update: Uint8Array) => { capturedUpdate = update; };
    this.doc.on('update', handler);
    this.doc.transact(() => {
      this.doc.getMap('objects').set(id, note);
    });
    this.doc.off('update', handler);
    if (capturedUpdate) this.sendUpdate(capturedUpdate);
    return id;
  }

  setText(noteId: string, text: string): void {
    const objects = this.doc.getMap('objects');
    const note = objects.get(noteId) as Y.Map<any> | undefined;
    if (!note) throw new Error(`note ${noteId} not found`);
    const textItem = note.get('text') as Y.Text;
    let capturedUpdate: Uint8Array | null = null;
    const handler = (update: Uint8Array) => { capturedUpdate = update; };
    this.doc.on('update', handler);
    this.doc.transact(() => {
      textItem.insert(0, text);
    });
    this.doc.off('update', handler);
    if (capturedUpdate) this.sendUpdate(capturedUpdate);
  }

  private sendUpdate(update: Uint8Array): void {
    if (!this.ws) return;
    try {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      sync.writeUpdate(enc, update);
      this.ws.send(encoding.toUint8Array(enc));
    } catch { /* WS not ready */ }
  }

  getNoteText(noteId: string): string {
    const objects = this.doc.getMap('objects');
    const note = objects.get(noteId) as Y.Map<any> | undefined;
    if (!note) return '';
    return (note.get('text') as Y.Text).toString();
  }

  getNoteCount(): number {
    return this.doc.getMap('objects').size;
  }

  getNoteIds(): string[] {
    const ids: string[] = [];
    this.doc.getMap('objects').forEach((note: any, id: string) => {
      ids.push(id);
    });
    return ids;
  }

  deleteNote(noteId: string): void {
    let capturedUpdate: Uint8Array | null = null;
    const handler = (update: Uint8Array) => { capturedUpdate = update; };
    this.doc.on('update', handler);
    this.doc.transact(() => {
      this.doc.getMap('objects').delete(noteId);
    });
    this.doc.off('update', handler);
    if (capturedUpdate) this.sendUpdate(capturedUpdate);
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
