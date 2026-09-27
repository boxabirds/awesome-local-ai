import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';
import { useCamera, type CameraApi } from './useCamera.ts';
import { worldToScreen, screenToWorld, type Camera, type Size, type Point } from './camera.ts';
import {
  GRID_SPACING_WORLD,
  WHEEL_DELTA_LINE_PX,
  WHEEL_DELTA_PAGE_PX,
  DRAG_THRESHOLD_PX,
} from '../../shared/config.ts';

// Wheel deltaMode constants (per UI Events spec).
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

function toPixels(delta: number, deltaMode: number): number {
  if (deltaMode === DOM_DELTA_LINE) return delta * WHEEL_DELTA_LINE_PX;
  if (deltaMode === DOM_DELTA_PAGE) return delta * WHEEL_DELTA_PAGE_PX;
  return delta;
}

// Positive modulo so CSS background-position stays inside one tile.
function mod(value: number, period: number): number {
  return ((value % period) + period) % period;
}

export interface BoardViewportProps {
  children?: React.ReactNode;
  onEmptyDoubleClick?(world: Point): void;
  onEmptyClick?(): void;
}

export interface ViewportHandles {
  camera: Camera;
  api: CameraApi;
}

// Exported for tests / wiring: the component also self-mounts in App.
export function useBoardCamera(): {
  api: CameraApi;
  rootRef: React.RefObject<HTMLDivElement | null>;
  viewport: Size;
} {
  const [viewport, setViewport] = useState<Size>(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const api = useCamera(viewport);
  const { setCamera } = api;

  // Always expose the *live* camera to the test hook via a ref.
  const camLive = useRef<Camera>(api.camera);
  camLive.current = api.camera;

  // Install the test-only __vidi6 hook. The import is dynamically loaded only
  // when MODE === 'test', so it is dropped from production builds.
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      void import('../testHooks.ts').then((m) =>
        m.installTestHooks({ setCamera, getCamera: () => camLive.current }),
      );
    }
  }, [setCamera]);

  // Track viewport size; camera x,y are deliberately NOT reset on resize.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setViewport({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { api, rootRef, viewport };
}

function dotGridBackground(cam: Camera): React.CSSProperties {
  const tile = GRID_SPACING_WORLD * cam.zoom;
  const pos = `${mod(-cam.x * cam.zoom, tile)}px ${mod(-cam.y * cam.zoom, tile)}px`;
  return {
    backgroundColor: '#fbfbfb',
    backgroundImage:
      'radial-gradient(circle, #c9c9c9 1px, transparent 1.4px)',
    backgroundSize: `${tile}px ${tile}px`,
    backgroundPosition: pos,
  };
}

function worldLayerTransform(cam: Camera): string {
  // Applies translate first, then scale => screen = (world - cam.xy) * zoom.
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}

export interface BoardViewportHandleProps {
  api: CameraApi;
  rootRef: React.RefObject<HTMLDivElement | null>;
  children?: React.ReactNode;
  onEmptyDoubleClick?(world: Point): void;
  onEmptyClick?(): void;
}

export function BoardViewportRoot({
  api,
  rootRef,
  children,
  onEmptyDoubleClick,
  onEmptyClick,
}: BoardViewportHandleProps): React.JSX.Element {
  const cam = api.camera;
  const dragRef = useRef(false);
  const gestureBaseline = useRef<Camera | null>(null);
  // Distinguish an empty-space click (clears selection) from a pan drag.
  const clickStart = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };

  // Non-passive wheel listener so we can preventDefault (React onWheel is passive).
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const dx = toPixels(e.deltaX, e.deltaMode);
      const dy = toPixels(e.deltaY, e.deltaMode);
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      api.wheel({ deltaX: dx, deltaY: dy, ctrlOrMeta, point: screenPoint(e) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [api, rootRef]);

  // Safari (macOS/iOS) trackpad pinch fires gesturestart/gesturechange/gestureend.
  useEffect(() => {
    const el = rootRef.current as unknown as HTMLElement | null;
    if (!el) return;
    const baseline = gestureBaseline;
    const onStart = (e: Event) => {
      e.preventDefault();
      baseline.current = api.camera;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      if (!Number.isFinite(ge.scale) || ge.scale <= 0) return;
      api.gestureZoom(baseline.current ?? api.camera, screenPoint(ge), ge.scale);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      baseline.current = null;
    };
    el.addEventListener('gesturestart', onStart as EventListener);
    el.addEventListener('gesturechange', onChange as EventListener);
    el.addEventListener('gestureend', onEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onStart as EventListener);
      el.removeEventListener('gesturechange', onChange as EventListener);
      el.removeEventListener('gestureend', onEnd as EventListener);
    };
  }, [api, rootRef]);

  // Ctrl/Cmd + = - 0 keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key;
      if (key === '=' || key === '+') {
        e.preventDefault();
        api.zoomStep('in');
      } else if (key === '-' || key === '_') {
        e.preventDefault();
        api.zoomStep('out');
      } else if (key === '0') {
        e.preventDefault();
        api.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [api]);

  const origin = worldToScreen(cam, { x: 0, y: 0 });

  return (
    <div
      ref={rootRef}
      data-testid="viewport"
      className="vp-root"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        ...dotGridBackground(cam),
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Only start a drag when the target is the viewport/grid itself, so later
        // object stories can keep their objects' own pointer handling.
        if (e.target !== rootRef.current) return;
        (e.target as Element).setPointerCapture(e.pointerId);
        dragRef.current = true;
        const p = screenPoint(e);
        clickStart.current = { x: p.x, y: p.y, moved: false };
        api.beginPan(p);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        const p = screenPoint(e);
        const c = clickStart.current;
        if (c && !c.moved && Math.hypot(p.x - c.x, p.y - c.y) >= DRAG_THRESHOLD_PX) {
          c.moved = true;
        }
        api.panMove(p);
      }}
      onPointerUp={(e) => {
        if (!dragRef.current) return;
        dragRef.current = false;
        api.endPan();
        const c = clickStart.current;
        clickStart.current = null;
        (e.target as Element).releasePointerCapture?.(e.pointerId);
        // A press with no movement on empty space is a click: clear selection.
        if (c && !c.moved) onEmptyClick?.();
      }}
      onDoubleClick={(e) => {
        // Only create from a double-click on empty board space, never on a note.
        if (e.target !== rootRef.current) return;
        if (!onEmptyDoubleClick) return;
        onEmptyDoubleClick(screenToWorld(cam, screenPoint(e)));
      }}
      onPointerCancel={() => {
        // Interrupted drag: keep the camera where it was at the moment of cancel.
        dragRef.current = false;
        api.endPan();
      }}
      onLostPointerCapture={() => {
        dragRef.current = false;
        api.endPan();
      }}
    >
      <div
        data-testid="world-layer"
        className="vp-world"
        data-transform={worldLayerTransform(cam)}
        data-cam-x={cam.x}
        data-cam-y={cam.y}
        data-cam-zoom={cam.zoom}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transformOrigin: '0 0',
          transform: worldLayerTransform(cam),
          pointerEvents: 'none',
        }}
      >
        {/* Origin marker: a small crosshair at world (0,0), a stable pixel target. */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 21,
            height: 21,
            marginLeft: -10.5,
            marginTop: -10.5,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: 0,
              width: 1,
              height: 21,
              background: '#e05656',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 10,
              width: 21,
              height: 1,
              background: '#e05656',
            }}
          />
        </div>
        {children}
      </div>
      {/* Expose the origin's screen position for tests via a data attribute. */}
      <span
        data-testid="origin-screen"
        style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', width: 0, height: 0 }}
        data-x={origin.x}
        data-y={origin.y}
      />
    </div>
  );
}

export function BoardViewport(props: BoardViewportProps): React.JSX.Element {
  const { api, rootRef } = useBoardCamera();
  return (
    <BoardViewportRoot
      api={api}
      rootRef={rootRef}
      onEmptyDoubleClick={props.onEmptyDoubleClick}
      onEmptyClick={props.onEmptyClick}
    >
      {props.children}
    </BoardViewportRoot>
  );
}
