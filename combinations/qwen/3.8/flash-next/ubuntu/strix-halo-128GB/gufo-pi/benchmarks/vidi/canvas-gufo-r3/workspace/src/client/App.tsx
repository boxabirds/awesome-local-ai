import React, { useRef, useEffect, useState } from 'react';
import { Camera, Size, canZoomIn, canZoomOut, zoomPercent } from '@client/canvas/camera';
import { useCamera } from '@client/canvas/useCamera';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { NavigationHint } from '@client/canvas/NavigationHint';
import { setupTestHooks } from '@client/canvas/testHooks';

export function App() {
  return <Board />;
}

function Board() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState<Size>({ width: 1280, height: 800 });
  const cameraState = useCamera(viewportSize);
  const { camera, hasNavigated, wheel, gestureZoom, zoomStep, reset, setCamera } = cameraState;

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setViewportSize({ width, height });
      }
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSize);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, []);

  // Test hooks
  useEffect(() => {
    setupTestHooks(setCamera);
  }, [setCamera]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomStep, reset]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <BoardViewport
        camera={camera}
        beginPan={cameraState.beginPan}
        panMove={cameraState.panMove}
        endPan={cameraState.endPan}
        wheel={wheel}
        gestureZoom={gestureZoom}
      />
      <ZoomControls
        zoomPercent={zoomPercent(camera)}
        canZoomIn={canZoomIn(camera)}
        canZoomOut={canZoomOut(camera)}
        onZoomIn={() => zoomStep('in')}
        onZoomOut={() => zoomStep('out')}
        onReset={reset}
      />
      <NavigationHint visible={!hasNavigated} />
    </div>
  );
}
