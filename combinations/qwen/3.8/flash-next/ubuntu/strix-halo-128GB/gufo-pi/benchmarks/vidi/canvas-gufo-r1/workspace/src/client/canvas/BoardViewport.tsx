import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { canZoomIn, canZoomOut, screenToWorld, type Size, zoomPercent } from './camera';
import { useCamera, type CameraController } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { GRID_SPACING_WORLD } from '../../shared/config';

// Delta-mode conversions (mouse wheel lines / pages to CSS pixels).
const WHEEL_LINE_HEIGHT_PX = 16;

// The three DOM_DELTA_* modes.
const DELTA_MODE_PIXEL = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function toPixels(delta: number, deltaMode: number, page: number): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return delta * WHEEL_LINE_HEIGHT_PX;
    case DELTA_MODE_PAGE:
      return delta * page;
    case DELTA_MODE_PIXEL:
    default:
      return delta;
  }
}

// Safari's non-standard GestureEvent carries an absolute `scale`.
interface GestureEventLike extends Event {
  scale: number;
  clientX: number;
  clientY: number;
}

// Pointer-like events, tolerant of the environments we run in (real browsers
// dispatch PointerEvent; jsdom does not implement the PointerEvent constructor,
// so tests dispatch a MouseEvent typed as "pointerdown"/"pointermove"/...).
interface PointerLike extends Event {
  clientX: number;
  clientY: number;
  pointerId: number;
}

function isBoardSurface(target: EventTarget | null, surface: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target === surface) return true;
  return target.dataset.boardGrid === 'true';
}

function isInsideControls(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('[data-testid="zoom-controls"]') !== null;
}

export interface BoardViewportProps {
  children?: ReactNode;
  onDblClickEmpty?(worldPoint: { x: number; y: number }): void;
  onEmptyClick?(): void;
  onCameraChange?(camera: { x: number; y: number; zoom: number }, viewport: Size): void;
}

export function BoardViewport({ children, onDblClickEmpty, onEmptyClick, onCameraChange }: BoardViewportProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const panningRef = useRef(false);

  const controller: CameraController = useCamera(viewport);
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  // Expose camera changes to parent
  const onCameraChangeRef = useRef(onCameraChange);
  onCameraChangeRef.current = onCameraChange;
  useEffect(() => {
    onCameraChangeRef.current?.(controller.camera, viewport);
  }, [controller.camera, viewport]);

  // Track the viewport size; camera x,y,zoom are intentionally untouched here.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setViewport({ width, height });
      }
    });
    ro.observe(el);
    setViewport({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Native, non-passive wheel listener: must be able to preventDefault so the
  // page never scrolls/zooms (React's onWheel is passive). (TC-15, TC-16, TC-31)
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Ctrl/Cmd wheel over the zoom control must not zoom the board and must
      // leave the browser default alone (TC-30).
      if (isInsideControls(e.target)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const deltaX = toPixels(e.deltaX, e.deltaMode, rect.width);
      const deltaY = toPixels(e.deltaY, e.deltaMode, rect.height);
      controllerRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Safari trackpad pinch (gesturestart / gesturechange). (TC-17)
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    let lastScale = 1;
    const onStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onChange = (e: Event) => {
      const ge = e as GestureEventLike;
      if (isInsideControls(ge.target)) return;
      e.preventDefault();
      const scale = ge.scale || 1;
      const factor = scale / (lastScale || 1);
      lastScale = scale;
      const rect = el.getBoundingClientRect();
      controllerRef.current.gesture(
        { x: ge.clientX - rect.left, y: ge.clientY - rect.top },
        factor,
      );
    };
    el.addEventListener('gesturestart', onStart, { passive: false });
    el.addEventListener('gesturechange', onChange, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onStart);
      el.removeEventListener('gesturechange', onChange);
    };
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd + (= / -) zoom one step, Ctrl/Cmd + 0 resets.
  // preventDefault stops the browser's own page zoom. (TC-18)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault();
          controllerRef.current.zoomStep('in');
          break;
        case '-':
        case '_':
          e.preventDefault();
          controllerRef.current.zoomStep('out');
          break;
        case '0':
          e.preventDefault();
          controllerRef.current.reset();
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Drag to pan via native pointer listeners. Pointer capture keeps events
  // flowing while the pointer is over other elements; if the environment has no
  // PointerEvent, panning still works from the event stream.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;

    const beginPan = (e: PointerLike) => {
      if (!isBoardSurface(e.target, el)) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // unavailable in some environments (jsdom) — ignore.
      }
      panningRef.current = true;
      setPanning(true);
      controllerRef.current.beginPan({ x: e.clientX, y: e.clientY });
    };

    const movePan = (e: PointerLike) => {
      if (!panningRef.current) return;
      controllerRef.current.panMove({ x: e.clientX, y: e.clientY });
    };

    const endPan = (e: PointerLike) => {
      if (!panningRef.current) return;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // already released — ignore.
      }
      panningRef.current = false;
      setPanning(false);
      controllerRef.current.endPan();
    };

    el.addEventListener('pointerdown', beginPan as EventListener);
    el.addEventListener('pointermove', movePan as EventListener);
    el.addEventListener('pointerup', endPan as EventListener);
    el.addEventListener('pointercancel', endPan as EventListener);
    el.addEventListener('lostpointercapture', endPan as EventListener);
    return () => {
      el.removeEventListener('pointerdown', beginPan as EventListener);
      el.removeEventListener('pointermove', movePan as EventListener);
      el.removeEventListener('pointerup', endPan as EventListener);
      el.removeEventListener('pointercancel', endPan as EventListener);
      el.removeEventListener('lostpointercapture', endPan as EventListener);
    };
  }, []);

  // Empty click (pointerdown + up on board surface without drag) clears selection
  const emptyClickRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onDown = (e: PointerLike) => {
      if (!isBoardSurface(e.target, el)) return;
      emptyClickRef.current = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerLike) => {
      const start = emptyClickRef.current;
      emptyClickRef.current = null;
      if (!start) return;
      if (!isBoardSurface(e.target, el)) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
        onEmptyClickRef.current?.();
      }
    };
    el.addEventListener('pointerdown', onDown as EventListener, true);
    el.addEventListener('pointerup', onUp as EventListener, true);
    return () => {
      el.removeEventListener('pointerdown', onDown as EventListener, true);
      el.removeEventListener('pointerup', onUp as EventListener, true);
    };
  }, []);

  const onEmptyClickRef = useRef(onEmptyClick);
  onEmptyClickRef.current = onEmptyClick;

  // Double-click on empty board space → create sticky
  const onDblClickEmptyRef = useRef(onDblClickEmpty);
  onDblClickEmptyRef.current = onDblClickEmpty;
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onDbl = (e: MouseEvent) => {
      if (!isBoardSurface(e.target, el)) return;
      const rect = el.getBoundingClientRect();
      const screenPoint = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const cam = controllerRef.current.camera;
      const world = screenToWorld(cam, screenPoint);
      onDblClickEmptyRef.current?.(world);
    };
    el.addEventListener('dblclick', onDbl);
    return () => el.removeEventListener('dblclick', onDbl);
  }, []);

  const cam = controller.camera;
  const zoom = cam.zoom;
  const spacingPx = GRID_SPACING_WORLD * zoom;
  const gridStyle: CSSProperties = {
    backgroundImage:
      'radial-gradient(circle, rgba(15, 23, 42, 0.18) 1.2px, transparent 1.3px)',
    backgroundSize: `${spacingPx}px ${spacingPx}px`,
    backgroundPosition: `${positiveModulo(-cam.x * zoom, spacingPx)}px ${positiveModulo(
      -cam.y * zoom,
      spacingPx,
    )}px`,
  };
  const worldStyle: CSSProperties = {
    transform: `scale(${zoom}) translate(${-cam.x}px, ${-cam.y}px)`,
    transformOrigin: '0 0',
  };

  return (
    <div
      ref={surfaceRef}
      className="board-viewport"
      data-testid="board-viewport"
      data-interaction={panning ? 'panning' : 'idle'}
      style={{ cursor: panning ? 'grabbing' : 'grab' }}
    >
      <div
        className="board-grid"
        data-testid="board-grid"
        data-board-grid="true"
        style={gridStyle}
      />
      <div className="board-world" data-testid="world-layer" style={worldStyle}>
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>

      <ZoomControls
        zoomPercent={zoomPercent(cam)}
        canZoomIn={canZoomIn(cam)}
        canZoomOut={canZoomOut(cam)}
        onZoomIn={() => controller.zoomStep('in')}
        onZoomOut={() => controller.zoomStep('out')}
        onReset={controller.reset}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </div>
  );
}
