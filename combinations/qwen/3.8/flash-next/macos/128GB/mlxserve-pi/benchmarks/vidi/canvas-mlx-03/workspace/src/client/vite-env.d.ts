/// <reference types="vite/client" />

interface Window {
  // Test-only hook; populated only when import.meta.env.MODE === 'test'.
  __vidi6?: {
    setCamera(camera: { x: number; y: number; zoom: number }): void;
    // Tear down the live room connection via y-websocket disconnect(); the badge
    // shows Reconnecting and it stays down until restoreConnection().
    simulateDrop?(): void;
    // Bring the connection back after simulateDrop() (real reconnect + resync).
    restoreConnection?(): void;
    // Mirrors the badge's mapped connection state (test builds only).
    connectionState?: string;
  };
}
