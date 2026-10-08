/**
 * Minimal ambient types for the Cloudflare Workers runtime.
 *
 * `@cloudflare/workers-types` is available for editors, but the project keeps
 * its own tiny declarations so that `tsc --noEmit` can typecheck `src/worker`
 * against the DOM lib that the client build already uses.  Everything here is
 * a superset-compatible description of what workerd actually exposes.
 */

// lib.dom's WebSocket has no accept(); workerd's server-side sockets do.
interface WebSocket {
  accept(): void
  readonly serializedState?: ArrayBuffer
  serializeState(): ArrayBuffer
  deserializeState(state: ArrayBuffer): void
}

interface WebSocketPairLike {
  [index: number]: WebSocket
}

declare const WebSocketPair: new () => WebSocketPairLike

interface Request {
  readonly webSocket?: WebSocket
}

interface ResponseInit {
  webSocket?: WebSocket
}

interface DurableObjectId {
  toString(): string
  equals(other: DurableObjectId): boolean
}

interface DurableObjectStub<T = unknown> {
  readonly id: DurableObjectId
  fetch(input: string | Request, init?: RequestInit): Promise<Response>
  ctx: unknown
  doc: T
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId
  idFromString(id: string): DurableObjectId
  newUniqueId(): DurableObjectId
  get(id: DurableObjectId): DurableObjectStub<T>
}

interface Fetcher {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>
}

interface SqlCursor<T extends Record<string, unknown>> extends Iterable<T> {
  toArray(): T[]
}

interface SqlStorage {
  exec<T extends Record<string, unknown>>(query: string, ...bindings: unknown[]): SqlCursor<T>
}

interface DurableObjectStorage {
  sql: SqlStorage
  transactionSync<T>(closure: () => T): T
}

interface DurableObjectState {
  readonly id: DurableObjectId
  readonly storage: DurableObjectStorage
  acceptWebSocket(webSocket: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>
}

declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = Record<string, unknown>> {
    constructor(ctx: DurableObjectState, env: Env)
    ctx: DurableObjectState
    env: Env
    state: DurableObjectState
  }
}
