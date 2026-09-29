declare module 'cloudflare:workers' {
  export class DurableObject<Env = any> {
    env: Env;
    ctx: DurableObjectState;
    constructor(ctx: DurableObjectState, env: Env);
    fetch?(req: Request, env: Env, ctx: DurableObjectState): Promise<Response> | Response;
  }

  export interface DurableObjectState {
    blockConcurrencyWhile(fn: () => Promise<unknown>): Promise<unknown>;
    waitUntil(promise: Promise<unknown>): void;
    abort(fn: () => void): void;
    passThroughOnException(): void;
    readonly id: string;
    readonly columnName: string;
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
