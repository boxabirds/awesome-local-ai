// Type declarations for Cloudflare Workers runtime
declare module 'cloudflare:workers' {
  export class DurableObject<T = unknown> {
    ctx: DurableObjectState;
    env: T;
    constructor(ctx: DurableObjectState, env: T);
  }

  interface DurableObjectState {
    blockConcurrencyWhile(fn: () => Promise<any>): Promise<any>;
    acceptWebSocket(source: WebSocket, pairs: WebSocketPair): void;
  }

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
  acceptWebSocket(source: WebSocket, pairs: WebSocketPair): void;
}

declare class WebSocketPair {
  readonly 0: WebSocket;
  readonly 1: WebSocket;
}

declare class Fetcher {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
