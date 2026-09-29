/**
 * Minimal Cloudflare Workers type declarations for the worker source files.
 * We avoid adding @cloudflare/workers-types to the global `types` array in
 * tsconfig.json because it conflicts with the DOM lib used by client code.
 * These declarations provide only the types needed in src/worker/.
 */

// cloudflare:workers module
declare module 'cloudflare:workers' {
  export class DurableObject<T = unknown> {
    ctx: DurableObjectState;
    env: T;
    constructor(ctx: DurableObjectState, env: T);
  }
}

// cloudflare:test module (integration tests)
declare module 'cloudflare:test' {
  export const SELF: Fetcher;
  export const env: Record<string, unknown>;
  export function runInDurableObject<O extends DurableObject, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
  export function getPlatformProxy<T = Record<string, unknown>>(options?: {
    configPath?: string;
  }): Promise<{ env: T; dispose(): Promise<void> }>;
  export function createExecutionContext(): ExecutionContext;
  export function reset(): Promise<void>;
}

interface DurableObjectState {
  id: DurableObjectId;
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  waitUntil(promise: Promise<unknown>): void;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSocketAttachments<T = unknown>(): T | null;
  listWebSockets(query?: string, iterationOptions?: IterableIteratorOptions): IterableIterator<WebSocket>;
}

interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  list<T = unknown>(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    reverse?: boolean;
  }): Promise<DurableObjectStorageMeta & { list: Map<string, T> }>;
  put(key: string, value: unknown, options?: { allowConcurrency?: boolean }): Promise<void>;
  put(
    entries: Record<string, unknown> | Map<string, unknown>,
    options?: { allowConcurrency?: boolean; allowUnconfirmed?: boolean },
  ): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  deleteAll(): Promise<void>;
  transaction<T>(closure: (txn: DurableObjectTransaction) => Promise<T>): Promise<T>;
  getSQL(): SqlStorage;
}

interface DurableObjectStorageMeta {
  readKeys: string[];
  readRanges: Array<{ start?: string; startAfter?: string; end?: string; prefix?: string }>;
  writtenKeys: string[];
  deletedKeys: string[];
  deletedRanges: Array<{ start?: string; startAfter?: string; end?: string; prefix?: string }>;
}

interface DurableObjectTransaction {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  list<T = unknown>(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    reverse?: boolean;
  }): Promise<DurableObjectStorageMeta & { list: Map<string, T> }>;
  put(key: string, value: unknown): Promise<void>;
  put(entries: Record<string, unknown> | Map<string, unknown>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  rollback(): void;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

interface SqlStorage {
  exec<T = Record<string, unknown>>(query: string, ...args: unknown[]): SqlStorageCursor<T>;
}

interface SqlStorageCursor<T = Record<string, unknown>> {
  next(): { done: boolean; value?: T };
  toArray(): T[];
  [Symbol.iterator](): IterableIterator<T>;
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  idFromId(id: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
}

interface DurableObjectStub<T = unknown> extends Fetcher {
  [key: string]: unknown;
}

interface Fetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  connect?(address: unknown): unknown;
}

interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
  [Symbol.iterator](): [WebSocket, WebSocket];
  client: WebSocket;
  server: WebSocket;
}

declare var WebSocketPair: {
  new (): WebSocketPair;
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ResponseInit {
  webSocket?: WebSocket;
}

interface IterableIteratorOptions {
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}
