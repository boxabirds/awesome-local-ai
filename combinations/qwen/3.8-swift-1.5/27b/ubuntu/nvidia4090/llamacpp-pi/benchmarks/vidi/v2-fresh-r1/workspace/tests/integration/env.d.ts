// Ambient types for the workerd integration pool (cloudflare:test).
// `cloudflare:test` is a virtual module provided by
// @cloudflare/vitest-pool-workers at runtime, so we declare its surface here.
// NOTE: must stay a script (no top-level imports) so `declare module` is an
// ambient declaration. Use inline import() types.

declare module 'cloudflare:test' {
  interface ProvidedEnv {
    BOARD_ROOM: DurableObjectNamespace<import('../src/worker/board-room').BoardRoom>;
    ASSETS: Fetcher;
  }
  export const env: ProvidedEnv;
  /** Service binding to the main worker (same isolate as the tests). */
  export const SELF: Fetcher;
  export function runInDurableObject<O extends DurableObject, R>(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>,
  ): Promise<R>;
  export function listDurableObjectIds<T>(
    namespace: DurableObjectNamespace<T>,
  ): Promise<DurableObjectId[]>;
}
