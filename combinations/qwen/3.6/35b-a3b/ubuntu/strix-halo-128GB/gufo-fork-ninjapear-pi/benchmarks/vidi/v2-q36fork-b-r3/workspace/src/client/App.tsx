import React, { useState } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import { zoomPercent, canZoomIn, canZoomOut } from './canvas/camera';

// Expose camera on window for E2E tests
declare global {
  interface Window {
    __getCamera?: () => ReturnType<typeof useCamera>['camera'] | null;
  }
}

export function App() {
  const [viewportSize] = useState({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, panMove, wheel, zoomStep, reset: camReset } = cameraState;

  // Expose camera for e2e inspection
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    window.__getCamera = () => camera;
  }

  // ── Dot grid styles ─────────────────────────────────────────────────
  const spacingPx = 24 * camera.zoom;
  const bgPosX = (-camera.x * camera.zoom) % spacingPx;
  const bgPosY = (-camera.y * camera.zoom) % spacingPx;

  return (
    <>
      <BoardViewport
        onPanMove={panMove}
        onWheel={(dx, dy, ctrlOrMeta, point) => wheel({ deltaX: dx, deltaY: dy, ctrlOrMeta, point })}
        onEndPan={cameraState.endPan}
        onKeyDownZoom={(action) => {
          if (action === 'zoomIn') zoomStep('in');
          else if (action === 'zoomOut') zoomStep('out');
          else camReset();
        }}
        style={{
          backgroundImage: `radial-gradient(circle, #999 1px, transparent 1px)`,
          backgroundSize: `${spacingPx}px ${spacingPx}px`,
          backgroundPosition: `${bgPosX}px ${bgPosY}px`,
        }}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={camReset}
      />
      <NavigationHint visible={!hasNavigated} />
    </>
  );
}
