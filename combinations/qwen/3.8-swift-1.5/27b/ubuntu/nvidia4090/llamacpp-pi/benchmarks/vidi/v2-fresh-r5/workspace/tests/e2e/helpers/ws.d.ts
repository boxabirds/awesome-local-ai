/**
 * Minimal type for the `ws` package (no @types/ws in the workspace). It is
 * only used to hand a WebSocket implementation to y-websocket in the E2E
 * seeding helper, so a loose declaration is sufficient.
 */
declare module 'ws' {
  const WebSocket: {
    new (url: string, protocols?: string | string[]): unknown;
    readonly OPEN: number;
    readonly CLOSING: number;
    readonly CLOSED: number;
  };
  export default WebSocket;
}
