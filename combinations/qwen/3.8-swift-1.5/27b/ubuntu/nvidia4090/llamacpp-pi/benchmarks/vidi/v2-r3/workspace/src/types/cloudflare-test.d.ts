declare module 'cloudflare:test' {
  export const SELF: Fetcher;
  export const env: {
    BOARD_ROOM: DurableObjectNamespace;
    ASSETS?: Fetcher;
  };
  export function createExecutionContext(): ExecutionContext;
}
