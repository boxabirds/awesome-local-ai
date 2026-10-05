/**
 * `Response#webSocket` is the undocumented half of a WebSocket upgrade: when a
 * service binding's handler returns `new Response(null, { status: 101, webSocket })`,
 * the caller gets the other end of the pair back on the response. The runtime has it;
 * `@cloudflare/workers-types` does not declare it, so the tests declare it here.
 */

export {};

declare global {
  interface Response {
    /** The client end of the upgraded connection, on a 101 response. */
    readonly webSocket?: WebSocket;
  }
}
