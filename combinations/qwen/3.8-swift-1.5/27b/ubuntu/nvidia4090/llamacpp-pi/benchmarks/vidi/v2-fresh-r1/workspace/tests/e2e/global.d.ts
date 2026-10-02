export {};

declare global {
  interface Window {
    /** Test-only camera hook (test mode builds only; see src/client/canvas/testHooks.ts). */
    __vidi6?: {
      setCamera(cam: { x: number; y: number; zoom: number }): void;
    };
  }
}
