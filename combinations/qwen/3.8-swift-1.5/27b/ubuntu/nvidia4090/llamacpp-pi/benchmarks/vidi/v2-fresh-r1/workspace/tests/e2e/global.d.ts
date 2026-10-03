export {};

declare global {
  interface Window {
    /** Test-only hooks (test mode builds only; see src/client/canvas/testHooks.ts). */
    __vidi6?: {
      setCamera(cam: { x: number; y: number; zoom: number }): void;
      getBoardId(): string;
      getConnectionState(): string;
      /** Test-only: drop the live connection (outage tests). */
      disconnect(): void;
      /** Test-only: resume the connection after an outage test. */
      reconnect(): void;
    };
  }
}
