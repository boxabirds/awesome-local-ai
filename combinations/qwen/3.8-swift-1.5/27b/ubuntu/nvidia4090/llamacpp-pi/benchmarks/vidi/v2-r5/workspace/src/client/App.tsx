// src/client/App.tsx
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { useCamera } from './canvas/useCamera';
import type { Size, Camera } from './canvas/camera';

// Test-only hook
declare global {
  interface Window {
    __vidi6?: {
      setCamera: (cam: Camera) => void;
    };
  }
}

function App(): ReactElement {
  const [viewport, setViewport] = useState<Size>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const cam = useCamera(viewport);

  // Track viewport size
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Expose test hook in test mode
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      window.__vidi6 = {
        setCamera: (c: Camera) => {
          cam.setCamera(c);
        },
      };
    }
    return () => {
      delete window.__vidi6;
    };
  });

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        beginPan={cam.beginPan}
        panMove={cam.panMove}
        endPan={cam.endPan}
        wheel={cam.wheel}
        zoomIn={cam.zoomIn}
        zoomOut={cam.zoomOut}
        reset={cam.reset}
      />
      <ZoomControls
        zoomPercent={cam.zoomPercent}
        canZoomIn={cam.canZoomIn}
        canZoomOut={cam.canZoomOut}
        onZoomIn={cam.zoomIn}
        onZoomOut={cam.zoomOut}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}

export { App };
