import { act } from 'react';
import { vi } from 'vitest';
import { resetCamera, type Camera } from '../../src/client/canvas/camera';

export function windowSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function initialCamera(): Camera {
  return resetCamera(windowSize());
}

// Mirrors the transform style BoardViewport applies to the world layer.
export function worldTransform(cam: Camera): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

export function flushFrames(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}
