// Board chrome (zoom controls + first-use hint) and the context that carries the
// camera API from BoardViewport (which owns it) to that chrome.
//
// The design wires these components in App.tsx; because the camera - and the
// viewport size it is derived from - live inside BoardViewport (design: "Viewport
// size from a ResizeObserver"), the wiring happens here instead. The prop
// contracts of ZoomControls and NavigationHint are exactly as designed.
import type { JSX } from "react";
import { createContext, useContext } from "react";

import { canZoomIn, canZoomOut, zoomPercent } from "./camera";
import { NavigationHint } from "./NavigationHint";
import type { CameraApi } from "./useCamera";
import { ZoomControls } from "./ZoomControls";

export const BoardCameraContext = createContext<CameraApi | null>(null);

export function useBoardCamera(): CameraApi {
  const api = useContext(BoardCameraContext);
  if (!api)
    throw new Error("useBoardCamera must be used inside a BoardViewport");
  return api;
}

export function BoardOverlay(): JSX.Element {
  const { camera, hasNavigated, zoomStep, reset } = useBoardCamera();
  return (
    <>
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep("in")}
        onZoomOut={() => zoomStep("out")}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}
