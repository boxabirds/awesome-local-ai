import { act } from '@testing-library/react';

export interface ParsedCamera { x: number; y: number; zoom: number }

/** Reads the camera back from the world layer's CSS transform. */
export function readCamera(world: HTMLElement): ParsedCamera {
  const m = /scale\(([^)]+)\) translate\(([^p]+)px, ([^p]+)px\)/.exec(world.style.transform);
  if (!m) throw new Error(`unparseable transform: ${world.style.transform}`);
  return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
}

/** Lets the hook's requestAnimationFrame batch flush into React state. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}
