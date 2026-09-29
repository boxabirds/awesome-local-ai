declare module 'cloudflare:workers' {
  export class DurableObject<Env = any> {
    env: Env;
    ctx: DurableObjectState;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(req: Request, env?: Env, ctx?: DurableObjectState): Promise<Response> | Response;
  }

  export interface DurableObjectState {
    blockConcurrencyWhile(fn: () => Promise<unknown>): Promise<unknown>;
    waitUntil(promise: Promise<unknown>): void;
    abort(fn: () => void): void;
    passThroughOnException(): void;
    readonly id: string;
    readonly columnName: string;
    getWebSockets(): WorkersWebSocket[];
    acceptWebSocket(ws: WorkersWebSocket): void;
    storage: DurableObjectStorage;
  }

  export interface DurableObjectStorage {
    sql: DurableObjectSQLite;
    transactionSync(fn: () => void): void;
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<{ key: string; value: T }[]>;
  }

  export interface DurableObjectSQLiteCursor {
    toArray(): any[];
    next(): { done: boolean; value?: any };
    one(): any;
    raw(): any;
    columnNames: string[];
    rowsRead: number;
    rowsWritten: number;
  }

  export interface DurableObjectSQLite {
    exec(query: string, ...params: any[]): DurableObjectSQLiteCursor;
  }
}

// Cloudflare Workers WebSocket (different from browser WebSocket)
declare class WorkersWebSocket {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
  accept(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: MessageEvent) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
}

declare class WebSocketPair {
  0: WorkersWebSocket;
  1: WorkersWebSocket;
}

interface MessageEvent {
  data: unknown;
}

// Cloudflare Workers Response can have a WebSocket as body
interface WorkersResponseInit extends ResponseInit {
  body?: BodyInit | WorkersWebSocket | null;
}

interface DurableObjectNamespace<T = any> {
  idFromName(name: string): string;
  idFromBinding(id: string): string;
  get(id: string): DurableObjectStub;
  newUniqueId(): string;
  jurisdiction(id: string): string;
}

interface DurableObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  stub: any;
}

interface Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

interface ExportedHandler<Env = any> {
  fetch?(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
