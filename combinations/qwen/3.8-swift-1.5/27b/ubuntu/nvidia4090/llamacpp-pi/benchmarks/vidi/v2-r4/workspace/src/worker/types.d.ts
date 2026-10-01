// Type declarations for Cloudflare Workers runtime
declare module 'cloudflare:workers' {
  export class DurableObject<T = unknown> {
    ctx: DurableObjectState;
    env: T;
    constructor(ctx: DurableObjectState, env: T);
    fetch?(req: Request): Promise<Response> | Response;
    webSocketMessage?(ws: WebSocket, message: ArrayBuffer | string): void;
    webSocketClose?(ws: WebSocket, code: number, reason: string, wasClean: boolean): void;
    webSocketError?(ws: WebSocket, error: unknown): void;
  }

  interface DurableObjectState {
    blockConcurrencyWhile(fn: () => Promise<any>): Promise<any>;
    acceptWebSocket(source: WebSocket, pairs: WebSocket[]): void;
    getWebSockets(): WebSocket[];
    storage: DurableObjectStorage;
    readonly id: string;
    readonly name: string;
  }

  interface DurableObjectStorage {
    sql: SqlStorage;
    transactionSync(fn: () => void): void;
  }

  interface SqlStorage {
    exec(sql: string, ...params: SqlValue[]): SqlStorageCursor;
    databaseSize: number;
  }

  interface SqlStorageCursor {
    one(): unknown;
    toArray(): unknown[];
    next(): unknown;
    rowsWritten: number;
    rowsRead: number;
    columnNames: string[];
  }

  type SqlValue = string | number | bigint | Uint8Array | ArrayBuffer | null;

  interface DurableObjectNamespace<T = unknown> {
    idFromName(name: string): string;
    get(id: string): DurableObjectStub<T>;
    newUniqueId(): string;
  }

  interface DurableObjectStub<T = unknown> {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
    id: string;
    name: string;
  }
}

// Cloudflare Workers globals
declare class DurableObjectNamespace<T = unknown> {
  idFromName(name: string): string;
  get(id: string): DurableObjectStub<T>;
  newUniqueId(): string;
}

declare class DurableObjectStub<T = unknown> {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  id: string;
  name: string;
}

declare class DurableObjectState {
  blockConcurrencyWhile(fn: () => Promise<any>): Promise<any>;
  acceptWebSocket(source: WebSocket, pairs: WebSocket[]): void;
  getWebSockets(): WebSocket[];
  storage: DurableObjectStorage;
  readonly id: string;
  readonly name: string;
}

interface DurableObjectStorage {
  sql: SqlStorage;
  transactionSync(fn: () => void): void;
}

interface SqlStorage {
  exec(sql: string, ...params: SqlValue[]): SqlStorageCursor;
  databaseSize: number;
}

interface SqlStorageCursor {
  one(): unknown;
  toArray(): unknown[];
  next(): unknown;
  rowsWritten: number;
  rowsRead: number;
  columnNames: string[];
}

type SqlValue = string | number | bigint | Uint8Array | ArrayBuffer | null;

declare class WebSocketPair {
  readonly 0: WebSocket;
  readonly 1: WebSocket;
}

declare class Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

// Test-only module provided by @cloudflare/vitest-pool-workers
declare module 'cloudflare:test' {
  import type { DurableObjectState, DurableObjectStub } from 'cloudflare:workers';
  export const env: any;
  export const SELF: Fetcher;
  export function runInDurableObject<O, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}
