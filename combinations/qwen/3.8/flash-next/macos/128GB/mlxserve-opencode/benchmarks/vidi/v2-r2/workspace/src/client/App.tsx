import { useEffect, useState } from 'react';
import { useCamera } from './canvas/useCamera';
import { BoardViewport } from './canvas/BoardViewport';
import { ZoomControls } from './canvas/ZoomControls';
import { NavigationHint } from './canvas/NavigationHint';
import { canZoomIn, canZoomOut, zoomPercent, Size, Camera } from './canvas/camera';

function useViewportSize(): Size {
  const [size, setSize] = useState<Size>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });
  useEffect(() => {
    const handler = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return size;
}

export default function App() {
  const viewport = useViewportSize();
  const cam = useCamera(viewport);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key;
      if (key === '=' || key === '+') {
        e.preventDefault();
        cam.zoomStep('in');
      } else if (key === '-') {
        e.preventDefault();
        cam.zoomStep('out');
      } else if (key === '0') {
        e.preventDefault();
        cam.reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cam.zoomStep, cam.reset]);

  // Test hook (only in test mode)
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as unknown as Record<string, unknown>).__vidi6 = {
        setCamera: (c: Camera) => cam.setCameraDirectly(c),
      };
    }
    return () => {
      delete (window as unknown as Record<string, unknown>).__vidi6;
    };
  }, [cam.setCameraDirectly]);

  return (
    <>
      <BoardViewport
        camera={cam.camera}
        onPointerDown={cam.beginPan}
        onPointerMove={cam.panMove}
        onPointerUp={cam.endPan}
        onWheel={cam.wheel}
        onGestureStart={cam.gestureStart}
        onGestureChange={cam.gestureChange}
      />
      <ZoomControls
        zoomPercent={zoomPercent(cam.camera)}
        canZoomIn={canZoomIn(cam.camera)}
        canZoomOut={canZoomOut(cam.camera)}
        onZoomIn={() => cam.zoomStep('in')}
        onZoomOut={() => cam.zoomStep('out')}
        onReset={cam.reset}
      />
      <NavigationHint visible={!cam.hasNavigated} />
    </>
  );
}
