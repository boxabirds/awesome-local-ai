/**
 * Shared harness for the story 1 component tests: renders the real
 * BoardViewport + ZoomControls + NavigationHint wired to a real useCamera
 * with an explicit viewport size (jsdom has no layout), plus a camera
 * snapshot for assertions.
 */
import type { ReactNode } from "react";
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { Size } from "../../src/client/canvas/camera";
import {
  canZoomIn,
  canZoomOut,
  zoomPercent,
} from "../../src/client/canvas/camera";
import { BoardViewport } from "../../src/client/canvas/BoardViewport";
import { CameraContext, useCamera } from "../../src/client/canvas/useCamera";
import { NavigationHint } from "../../src/client/canvas/NavigationHint";
import { ZoomControls } from "../../src/client/canvas/ZoomControls";

export const TEST_VIEWPORT: Size = { width: 1280, height: 800 };

export function TestBoard({
  size = TEST_VIEWPORT,
  children,
}: {
  size?: Size;
  children?: ReactNode;
}) {
  const api = useCamera(size);
  return (
    <CameraContext.Provider value={api}>
      <div>
        <BoardViewport>{children}</BoardViewport>
        <ZoomControls
          zoomPercent={zoomPercent(api.camera)}
          canZoomIn={canZoomIn(api.camera)}
          canZoomOut={canZoomOut(api.camera)}
          onZoomIn={() => api.zoomStep("in")}
          onZoomOut={() => api.zoomStep("out")}
          onReset={api.reset}
        />
        <NavigationHint visible={!api.hasNavigated} />
        <output data-testid="camera-snapshot">
          {JSON.stringify(api.camera)}
        </output>
      </div>
    </CameraContext.Provider>
  );
}

/**
 * Advance one fake animation frame so rAF-coalesced camera updates flush, and
 * let React finish the resulting render (the flush happens outside act).
 */
export async function advanceFrame(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(16);
  });
}
