declare module 'cloudflare:test' {
  export const SELF: {
    fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
  };

  interface TestDurableObjectStub {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
    stub: unknown;
  }
  interface TestDurableObjectNamespace {
    idFromName(name: string): string;
    get(id: string): TestDurableObjectStub;
    newUniqueId(): string;
  }

  /** The test-worker env bindings (a real DurableObjectNamespace for BOARD_ROOM). */
  export const env: {
    BOARD_ROOM: TestDurableObjectNamespace;
  };

  /**
   * Runs `fn` against the live Durable Object instance behind `stub`, awaiting
   * the result. The same instance is reused across calls (in-memory state
   * persists) until `evictDurableObject` tears it down.
   */
  export function runInDurableObject<T, R>(
    stub: TestDurableObjectStub,
    fn: (instance: T) => R | Promise<R>,
  ): Promise<R>;

  /** Tears down the DO instance (fresh constructor on next use) while keeping durable storage. */
  export function evictDurableObject(stub: TestDurableObjectStub): Promise<void>;

  /** Clears all Durable Object storage in the test worker. */
  export function reset(): Promise<void>;
}
