import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GRID_SPACING_WORLD } from '../../shared/config';
import { NavigationHint } from './NavigationHint';
import { ZoomControls } from './ZoomControls';
import { useCamera, wheelDeltaToPixels, type CameraController } from './useCamera';
import type { Point, Size } from './camera';

/** Safari's pinch gesture events; not in the standard DOM typings. */
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Positive modulo, so a background position is always within one tile. */
function mod(value: number, modulo: number): number {
  if (!(modulo > 0) || !Number.isFinite(value)) return 0;
  return ((value % modulo) + modulo) % modulo;
}

/** True when the key event should go to the focused field instead of the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * The board's input surface: an unbounded dot grid plus a world layer that both
 * follow the camera.
 *
 * - Drag on empty board space pans (pointer capture; ends on pointerup,
 *   pointercancel or lost capture).
 * - A non-passive wheel handler always calls `preventDefault`, so scrolling
 *   pans and Ctrl/Cmd-scroll (or a trackpad pinch) zooms the *board*, never the
 *   web page.
 * - Safari `gesturestart`/`gesturechange` are prevented and zoom around the
 *   pointer.
 * - Ctrl/Cmd + `=`, `-` and `0` zoom one step or reset the view.
 */
export function BoardViewport({ children }: { children?: ReactNode }): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const controller: CameraController = useCamera(viewport);
  const controllerRef = useRef<CameraController>(controller);
  controllerRef.current = controller;
  const panningRef = useRef(false);

  // Viewport size. The camera is defined against the top-left of the board
  // area, so a resize never moves content.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const rect = entry ? entry.contentRect : el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    }
    return () => observer.disconnect();
  }, []);

  const pointOf = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // Wheel: React's onWheel is registered passive, so listen directly.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // Always claimed by the board: the page must never scroll or zoom here.
      event.preventDefault();
      const point = pointOf(event.clientX, event.clientY);
      controllerRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pointOf]);

  // Safari pinch gestures.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let lastScale = 1;
    const onStart = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const ratio = gesture.scale / (lastScale || 1);
      lastScale = gesture.scale;
      if (ratio === 1) return;
      controllerRef.current.pinchAt(pointOf(gesture.clientX, gesture.clientY), ratio);
    };
    const onEnd = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const handlers: ReadonlyArray<readonly [string, (event: Event) => void]> = [
      ['gesturestart', onStart],
      ['gesturechange', onChange],
      ['gestureend', onEnd],
    ];
    for (const [type, handler] of handlers) {
      el.addEventListener(type, handler, { passive: false });
    }
    return () => {
      for (const [type, handler] of handlers) {
        el.removeEventListener(type, handler);
      }
    };
  }, [pointOf]);

  // Keyboard zoom shortcuts: Ctrl/Cmd + = , - and 0. Preventing the default
  // stops the browser's own page zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isTextEntry(event.target)) return;
      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault();
          controllerRef.current.zoomStep('in');
          break;
        case '-':
        case '_':
          event.preventDefault();
          controllerRef.current.zoomStep('out');
          break;
        case '0':
          event.preventDefault();
          controllerRef.current.reset();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const stopPanning = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    controllerRef.current.endPan();
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const el = viewportRef.current;
      if (!el) return;
      // Only empty board space starts a drag; objects stop propagation.
      if (event.target !== el) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      el.setPointerCapture?.(event.pointerId);
      panningRef.current = true;
      setPanning(true);
      controllerRef.current.beginPan(pointOf(event.clientX, event.clientY));
    },
    [pointOf],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!panningRef.current) return;
      controllerRef.current.panMove(pointOf(event.clientX, event.clientY));
    },
    [pointOf],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const el = viewportRef.current;
      if (el?.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }
      stopPanning();
    },
    [stopPanning],
  );

  const { camera } = controller;
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridStyle = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, var(--grid-dot) 1.5px, transparent 1.5px)',
    backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
    backgroundPosition: `${mod(-camera.x * camera.zoom, gridSpacing)}px ${mod(
      -camera.y * camera.zoom,
      gridSpacing,
    )}px`,
  };
  const worldStyle = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  };

  return (
    <>
      <div
        ref={viewportRef}
        className="board-viewport"
        data-testid="board-viewport"
        aria-label="Board"
        data-panning={panning ? 'true' : 'false'}
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-zoom={camera.zoom}
        style={gridStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={stopPanning}
        onLostPointerCapture={stopPanning}
      >
        <div
          className="board-world"
          data-testid="world-layer"
          style={worldStyle}
        >
          <div
            className="origin-marker"
            data-testid="origin-marker"
            aria-hidden="true"
            style={{ transform: `translate(-50%, -50%) scale(${1 / camera.zoom})` }}
          />
          {children}
        </div>
      </div>
      <ZoomControls
        zoomPercent={controller.zoomPercent}
        canZoomIn={controller.canZoomIn}
        canZoomOut={controller.canZoomOut}
        onZoomIn={() => controllerRef.current.zoomStep('in')}
        onZoomOut={() => controllerRef.current.zoomStep('out')}
        onReset={() => controllerRef.current.reset()}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </>
  );
}
