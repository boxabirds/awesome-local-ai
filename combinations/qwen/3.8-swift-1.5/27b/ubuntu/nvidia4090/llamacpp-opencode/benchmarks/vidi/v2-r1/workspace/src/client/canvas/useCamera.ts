import { useState, useRef, useCallback, useEffect } from 'react';
import type { Camera, Point, Size } from './camera';
import { panBy, zoomAt, zoomStep as zoomStepFn, resetCamera } from './camera';
import { WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

export function useCamera(viewport: Size) {
  const [camera, setCamera] = useState<Camera>(() => resetCamera(viewport));
  const hasNavigatedRef = useRef(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  const panStartRef = useRef<Point | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  // Wrapper that tracks navigation and sets camera
  const applyCamera = useCallback((updater: (prev: Camera) => Camera) => {
    setCamera(prev => {
      const next = updater(prev);
      if (next !== prev && !hasNavigatedRef.current) {
        hasNavigatedRef.current = true;
        setHasNavigated(true);
      }
      return next;
    });
  }, []);

  const beginPan = useCallback((p: Point) => {
    panStartRef.current = p;
  }, []);

  const panMove = useCallback((p: Point) => {
    const start = panStartRef.current;
    if (!start) return;
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (dx === 0 && dy === 0) return;

    applyCamera(prev => panBy(prev, dx, dy));
    panStartRef.current = p;
  }, [applyCamera]);

  const endPan = useCallback(() => {
    panStartRef.current = null;
  }, []);

  const wheel = useCallback((e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => {
    if (e.ctrlOrMeta) {
      const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
      applyCamera(prev => zoomAt(prev, e.point, factor));
    } else {
      applyCamera(prev => panBy(prev, -e.deltaX, -e.deltaY));
    }
  }, [applyCamera]);

  const zoomStep = useCallback((dir: 'in' | 'out') => {
    applyCamera(prev => zoomStepFn(prev, viewportRef.current, dir));
  }, [applyCamera]);

  const reset = useCallback(() => {
    applyCamera(() => resetCamera(viewportRef.current));
  }, [applyCamera]);

  const setCameraDirect = useCallback((cam: Camera) => {
    setCamera(cam);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
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

  return { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCameraDirect };
}
