/**
 * A WebSocket that never opens, never closes by itself and sends nothing: the default for component
 * tests, so a mounted LiveProvider stays quietly 'connecting' and never reaches a real network.
 * Story 4 tests use mock-socket servers (test/support/live.ts) instead.
 */
export class InertSocket extends EventTarget {
  readonly url: string;
  readyState = 0;
  constructor(url: string) {
    super();
    this.url = url;
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
}

export function inertSocketFactory(url: string): WebSocket {
  return new InertSocket(url) as unknown as WebSocket;
}
