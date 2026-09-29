import { act } from '@testing-library/react';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MESSAGE_SYNC } from '../../src/shared/protocol';

/** Controllable stand-in for the browser WebSocket used by the real WebsocketProvider. */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readyState = 0;
  binaryType = 'blob';
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  static latest() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
  /** Opens and completes the initial sync from an empty server doc. */
  openAndSync() {
    act(() => {
      this.readyState = 1;
      this.onopen?.();
      const e = encoding.createEncoder();
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep2(e, new Y.Doc());
      this.onmessage?.({ data: encoding.toUint8Array(e).buffer as ArrayBuffer });
    });
  }
  /** The server (or network) ends the connection with `code`. */
  serverClose(code = 1006) {
    act(() => {
      this.readyState = 3;
      this.onclose?.({ code, reason: '' });
    });
  }
}
