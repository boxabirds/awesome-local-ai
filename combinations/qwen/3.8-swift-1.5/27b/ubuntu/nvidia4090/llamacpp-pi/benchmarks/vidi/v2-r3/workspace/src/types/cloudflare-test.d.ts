declare module 'cloudflare:test' {
  export const SELF: Fetcher;
  export const env: {
    BOARD_ROOM: DurableObjectNamespace;
    ASSETS?: Fetcher;
  };
  export function createExecutionContext(): ExecutionContext;
  export function runInDurableObject<
    O extends DurableObject,
    R,
  >(
    stub: DurableObjectStub<O>,
    callback: (instance: O, state: DurableObjectState) => R | Promise<R>
  ): Promise<R>;
}
