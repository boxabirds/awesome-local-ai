/**
 * Minimal Cloudflare Workers type declarations for the vidi6 project.
 * These are used by the Worker code in src/worker/.
 */

declare module 'cloudflare:workers' {
  /**
   * Cursor returned by `SqlStorage.exec` for SELECT (and DML) statements.
   * BLOB columns are read back as `ArrayBuffer`.
   */
  export interface SqlStorageCursor {
    one<T = any>(): T | undefined;
    toArray<T = any>(): T[];
    next<T = any>(): T | undefined;
    raw(): unknown;
    readonly columnNames: string[];
    readonly rowsRead: number;
    readonly rowsWritten: number;
  }

  /**
   * Synchronous SQLite API. `exec` binds parameters variadically:
   * `exec('INSERT INTO t (a) VALUES (?)', value)`. BLOBs bind as `Uint8Array`.
   */
  export interface SqlStorage {
    exec(sql: string, ...params: unknown[]): SqlStorageCursor;
    readonly databaseSize: number;
  }

  /**
   * Durable Object storage: KV + synchronous SQLite. `transactionSync` runs a
   * synchronous transaction that rolls back if the callback throws.
   */
  export interface DurableObjectStorage {
    readonly sql: SqlStorage;
    transactionSync<T>(fn: () => T): T;
  }

  export interface DurableObjectState {
    readonly id: string;
    readonly ctx: DurableObjectCtx;
    readonly storage: DurableObjectStorage;
  }

  export interface DurableObjectCtx {
    acceptWebSocket(source: any, tags?: any): Response;
    getWebSockets(): any[];
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
    /** Hibernation API: called when an accepted socket receives a message. */
    webSocketMessage(ws: any, message: string | ArrayBuffer): void | Promise<void>;
    /** Hibernation API: called when an accepted socket closes. */
    webSocketClose(ws: any, code: number, reason: string, wasClean: boolean): void | Promise<void>;
    /** Hibernation API: called when an accepted socket errors. */
    webSocketError(ws: any, error: Error): void | Promise<void>;
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
