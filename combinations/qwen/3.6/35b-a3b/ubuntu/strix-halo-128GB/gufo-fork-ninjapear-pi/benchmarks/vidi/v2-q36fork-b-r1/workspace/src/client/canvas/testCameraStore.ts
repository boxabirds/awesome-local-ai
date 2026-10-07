/**
 * Shared mutable store for test-mode camera override.
 * One-shot: read returns and clears the value so it only applies once per call.
 */

import type { Camera } from './camera';

let _override: Camera | null = null;

export function getTestOverride(): Camera | null {
  const o = _override;
  if (o) _override = null;
  return o;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setTestOverride(cam: any): void {
  _override = { x: cam.x, y: cam.y, zoom: cam.zoom };
}
