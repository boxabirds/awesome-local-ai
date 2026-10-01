import { newBoardId } from '../../src/shared/board-id';

// Component tests render <App/> on a board route and must never open a real socket.
class NeverOpensWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  binaryType = 'blob';
  onopen: unknown = null;
  onclose: unknown = null;
  onmessage: unknown = null;
  onerror: unknown = null;
  constructor(public url: string) { super(); }
  send(): void {}
  close(): void { this.readyState = 3; }
}
Object.defineProperty(globalThis, 'WebSocket', { value: NeverOpensWebSocket, configurable: true });
history.replaceState(null, '', `/b/${newBoardId()}`);
