/// <reference types="vite/client" />

interface Window {
  // Test-only hook; populated only when import.meta.env.MODE === 'test'.
  __vidi6?: {
    setCamera(camera: { x: number; y: number; zoom: number }): void;
  };
}
