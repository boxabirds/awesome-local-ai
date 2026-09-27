import { act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';

import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import type { Camera, Size } from '../../src/client/canvas/camera';
import { CameraContext, useCamera, type CameraApi } from '../../src/client/canvas/useCamera';

/** Board area used by component tests. */
export const VIEWPORT: Size = { width: 1200, height: 800 };

/** The standard view: 100% with the board's start point centred. */
export const INITIAL_CAMERA: Camera = {
  x: -VIEWPORT.width / 2,
  y: -VIEWPORT.height / 2,
  zoom: 1,
};

export interface HarnessProps {
  children?: ReactNode;
  /** Called with the newest camera API after every render. */
  onApi?: (api: CameraApi) => void;
}

/**
 * Mounts the board with a real camera hook (fixed viewport size) and the
 * navigation hint, so tests drive exactly the wiring `App` uses.
 */
export function BoardHarness({ children, onApi }: HarnessProps) {
  const api = useCamera(VIEWPORT);
  useEffect(() => {
    onApi?.(api);
  });
  return (
    <CameraContext.Provider value={api}>
      <BoardViewport />
      <NavigationHint visible={!api.hasNavigated} />
      {children}
    </CameraContext.Provider>
  );
}

/** Let the camera hook's coalesced frame run. */
export async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Run a camera API call and let the resulting render happen. */
export async function applyToCamera(
  api: CameraApi | undefined,
  run: (api: CameraApi) => void,
): Promise<void> {
  if (api === undefined) throw new Error('camera API not captured yet');
  await act(async () => {
    run(api);
  });
  await flushFrame();
}
