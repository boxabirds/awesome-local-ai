/**
 * Local type declarations for the `cloudflare:test` module used by workerd
 * integration tests (the pool injects its own copy at test runtime).
 */
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    BOARD_ROOM: DurableObjectNamespace<unknown>;
  }

  export const env: ProvidedEnv;

  /** Service binding to the main worker. */
  export const SELF: Fetcher;

  /**
   * Runs `callback` inside the Durable Object pointed to by `stub`,
   * returning the result (serialized).
   */
  export function runInDurableObject<O, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
}
