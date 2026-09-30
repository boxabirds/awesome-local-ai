// Ambient types: Safari gesture events and the test-only camera hook.

interface GestureEvent extends UIEvent {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

interface Window {
  // Test-only hook, installed only when import.meta.env.MODE === 'test'.
  __vidi6?: {
    setCamera(camera: { x: number; y: number; zoom: number }): void;
  };
}
