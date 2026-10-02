import React, { useState, useEffect, useCallback } from 'react';
import { useCamera } from '../../src/client/canvas/useCamera';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { NavigationHint } from '../../src/client/canvas/NavigationHint';
import type { Size } from '../../src/client/canvas/camera';
import { zoomPercent, canZoomIn, canZoomOut } from '../../src/client/canvas/camera';

interface TestAppProps {
  viewport?: Size;
}

export function TestApp({ viewport = { width: 1280, height: 800 } }: TestAppProps) {
  const {
    camera,
    hasNavigated,
    beginPan,
    panMove,
    endPan,
    wheel,
    gestureZoom,
    zoomStep,
    reset,
    setCamera,
  } = useCamera(viewport);

  // Expose camera for assertions
  useEffect(() => {
    (window as any).__testCamera = camera;
    (window as any).__testSetCamera = setCamera;
  }, [camera, setCamera]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomStep, reset]);

  const handleGestureZoom = useCallback(
    (scale: number, point: { x: number; y: number }) => {
      gestureZoom(scale, point);
    },
    [gestureZoom],
  );

  return (
    <>
      <BoardViewport
        camera={camera}
        onBeginPan={beginPan}
        onPanMove={panMove}
        onEndPan={endPan}
        onWheel={wheel}
        onGestureZoom={handleGestureZoom}
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
    </>
  );
}
