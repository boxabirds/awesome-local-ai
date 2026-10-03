/**
 * Minimal Cloudflare Workers type declarations for the vidi6 project.
 * These are used by the Worker code in src/worker/.
 */

declare module 'cloudflare:workers' {
  export interface DurableObjectState {
    readonly id: string;
    readonly ctx: DurableObjectCtx;
  }

  export interface DurableObjectCtx {
    acceptWebSocket(source: any, tags?: any): boolean;
    waitForEvent(): Promise<void>;
    abort(): void;
    readonly log: {
      info(message: string): void;
      error(message: string): void;
    };
  }

  export abstract class DurableObject<Env = unknown> {
    constructor(state: DurableObjectState, env: Env);
    abstract fetch(request: Request, env: Env, ctx: DurableObjectCtx): Promise<Response>;
  }
}

// Cloudflare Worker global types
interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): string;
  get(id: string): DurableObjectStub;
  idFromBinding(name: string): string;
  newUniqueId(): string;
  jurisdiction(id: string): string;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  stub: unknown;
}

type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type ExportedHandler<Env = unknown> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Cloudflare Workers WebSocket (differs from browser WebSocket)
// In Cloudflare Workers, WebSocketPair() creates a pair of WebSockets.
// The server side has .accept(), .send(), .close(), .onmessage, etc.

interface WorkersWebSocket {
  accept(): WorkersWebSocket;
  close(code?: number, reason?: string): void;
  send(data: string | ArrayBuffer | Uint8Array): void;
  readonly readyState: number;
  binaryType: string;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

interface WorkersWebSocketPair {
  0: WorkersWebSocket;
  1: WorkersWebSocket;
}

declare class WebSocketPair {
  0: WorkersWebSocket;
  1: WorkersWebSocket;
}

declare namespace WebSocket {
  // Static constants
  const OPEN: number;
  const CLOSED: number;
  const CLOSING: number;
  const CONNECTING: number;
}

// Extend Response to support webSocket property
interface ResponseInit {
  status?: number;
  statusText?: string;
  headers?: HeadersInit;
  webSocket?: WorkersWebSocket;
}
