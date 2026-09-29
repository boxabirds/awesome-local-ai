import { Camera } from './camera';

interface CameraApi {
  camera: Camera;
  setCamera?: (cam: Camera) => void;
}

export function setupTestHooks(cam: CameraApi) {
  // Test hook available in all builds for e2e testing
  // In a production deployment, this would be gated behind a flag
  (window as any).__vidi6 = {
    setCamera: (x: number, y: number, zoom: number) => {
      cam.setCamera?.({ x, y, zoom });
    },
    getCamera: () => cam.camera,
  };
}
