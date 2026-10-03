import type { Camera } from './camera';

export interface TestHooks {
  setCamera: (cam: Camera) => void;
  getBoardId: () => string;
  getConnectionState: () => string;
  /** Test-only: drop the live connection (outage tests). */
  disconnect(): void;
  /** Test-only: resume the connection after an outage test. */
  reconnect(): void;
  /** Test-only: simulate dropping image files onto the board at a world point. */
  dropImageFiles?(files: { name: string; data: number[]; type: string }[], worldX?: number, worldY?: number): void;
}

/**
 * Test-only hook: `window.__vidi6` lets e2e tests jump the camera to a far
 * location (dragging a million pixels is impractical), read the current
 * board id (to open a second participant on the same board) and read the
 * connection state (status badge assertions). Enabled only when
 * `import.meta.env.MODE === 'test'`, so the block is dead-code-eliminated
 * from production builds.
 */
export function installTestHooks(
  setCamera: (cam: Camera) => void,
  getBoardId: () => string = () => '',
  getConnectionState: () => string = () => '',
  dropImageFiles?: (files: { name: string; data: number[]; type: string }[], worldX?: number, worldY?: number) => void,
): void {
  if (import.meta.env.MODE !== 'test') return;
  (window as { __vidi6?: TestHooks }).__vidi6 = {
    setCamera,
    getBoardId,
    getConnectionState,
    disconnect: () => {
      const provider = (window as unknown as {
        __vidi6Provider?: { disconnect(): void; ws?: { close(): void } };
      }).__vidi6Provider;
      try {
        provider?.disconnect();
      } catch {
        provider?.ws?.close();
      }
    },
    reconnect: () => {
      const provider = (window as unknown as {
        __vidi6Provider?: { connect(): void };
      }).__vidi6Provider;
      provider?.connect();
    },
    ...(dropImageFiles ? { dropImageFiles } : {}),
  };
}
