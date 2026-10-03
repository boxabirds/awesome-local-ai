/**
 * Type declaration for the `cloudflare:workers` module.
 * This module is only available in the Cloudflare Workers runtime (workerd).
 * It provides the DurableObject base class and other runtime primitives.
 */
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    constructor(state: DurableObjectState, env: Env);
    abstract fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
    webSocketMessage?(ws: WebSocket, message: string | ArrayBuffer): void | Promise<void>;
    webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): void | Promise<void>;
    webSocketError?(ws: WebSocket, error: unknown): void | Promise<void>;
  }
}
