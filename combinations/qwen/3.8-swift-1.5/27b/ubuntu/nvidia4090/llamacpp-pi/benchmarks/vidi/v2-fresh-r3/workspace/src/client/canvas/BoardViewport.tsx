import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useCamera } from './useCamera';
import { ZoomControls } from './ZoomControls';
import { NavigationHint } from './NavigationHint';
import { zoomPercent, canZoomIn, canZoomOut, Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';
import { registerSetCamera, registerVidi6Hook } from './testHooks';

export interface MarqueeControls {
  begin(p: Point): void;
  move(p: Point): void;
  end(): void;
  cancel(): void;
}

export interface BoardViewportProps {
  children?: ReactNode;
  /** Reports the current camera (App uses it for world-space calculations). */
  onCamera?(cam: Camera): void;
  /** Double-click on empty board space, at a point relative to the viewport. */
  onEmptyDoubleClick?(p: Point): void;
  /** A click (press without movement) on empty board space. */
  onEmptyClick?(): void;
  /**
   * Shift+drag marquee (story 7). When present, a Shift+pointerdown on empty
   * space starts the marquee; a plain pointerdown still pans (story 1).
   */
  marquee?: MarqueeControls;
}

export function BoardViewport(props: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1280, height: 800 });
  const { camera, hasNavigated, beginPan, panMove, endPan, wheel, zoomStep, reset, setCamera } =
    useCamera(viewportSize);

  // Register test hook (available in all builds for e2e testing)
  useEffect(() => {
    registerSetCamera(setCamera);
    registerVidi6Hook({ setCamera: (cam) => setCamera(cam) });
  }, [setCamera]);

  // Report the camera to the parent
  useEffect(() => {
    props.onCamera?.(camera);
  }, [camera, props.onCamera]);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setViewportSize({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Pointer drag
  const isPanning = useRef(false);
  const panMoved = useRef(false);
  const marqueeActive = useRef(false);

  const viewportPoint = (e: React.PointerEvent): Point => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== e.currentTarget) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      // Shift+drag on empty space selects (story 7); plain drag pans (story 1).
      if (e.shiftKey && props.marquee) {
        marqueeActive.current = true;
        props.marquee.begin(viewportPoint(e));
        return;
      }
      isPanning.current = true;
      panMoved.current = false;
      beginPan({ x: e.clientX, y: e.clientY });
    },
    [beginPan, props.marquee],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (marqueeActive.current) {
        props.marquee?.move(viewportPoint(e));
        return;
      }
      if (!isPanning.current) return;
      const last = panState.current;
      if (last && (e.clientX !== last.x || e.clientY !== last.y)) {
        panMoved.current = true;
      }
      panState.current = { x: e.clientX, y: e.clientY };
      panMove({ x: e.clientX, y: e.clientY });
    },
    [panMove, props.marquee],
  );

  const panState = useRef<{ x: number; y: number } | null>(null);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (marqueeActive.current) {
        marqueeActive.current = false;
        props.marquee?.move(viewportPoint(e)); // extend to the release point
        props.marquee?.end();
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        return;
      }
      if (!isPanning.current) return;
      isPanning.current = false;
      panState.current = null;
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      endPan();
      // A click on empty board space (press without movement) clears the
      // selection. Note drags stopPropagation, so they never get here.
      if (!panMoved.current) {
        props.onEmptyClick?.();
      }
    },
    [endPan, props.onEmptyClick, props.marquee],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== e.currentTarget) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      props.onEmptyDoubleClick?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [props.onEmptyDoubleClick],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (marqueeActive.current) {
        marqueeActive.current = false;
        props.marquee?.cancel(); // discard: selection unchanged
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        return;
      }
      if (!isPanning.current) return;
      isPanning.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      endPan();
    },
    [endPan, props.marquee],
  );

  // Wheel (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const WHEEL_DELTA_LINE = 16;
    const WHEEL_DELTA_PAGE = 100;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;
      if (e.deltaMode === 1) {
        deltaX *= WHEEL_DELTA_LINE;
        deltaY *= WHEEL_DELTA_LINE;
      } else if (e.deltaMode === 2) {
        deltaX *= WHEEL_DELTA_PAGE;
        deltaY *= WHEEL_DELTA_PAGE;
      }

      wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let gestureScale = 1;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as any;
      const scale = ge.scale;
      const factor = scale / gestureScale;
      gestureScale = scale;

      const rect = el.getBoundingClientRect();
      const point = {
        x: ge.clientX ? ge.clientX - rect.left : rect.width / 2,
        y: ge.clientY ? ge.clientY - rect.top : rect.height / 2,
      };

      // Convert scale ratio to deltaY equivalent
      const deltaY = -Math.log(factor) / 0.01;
      wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
    };

    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, [wheel]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // Dot grid styles
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgX = ((-camera.x * camera.zoom) % spacing + spacing) % spacing;
  const bgY = ((-camera.y * camera.zoom) % spacing + spacing) % spacing;

  const gridStyle: React.CSSProperties = {
    backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
    backgroundSize: `${spacing}px ${spacing}px`,
    backgroundPosition: `${bgX}px ${bgY}px`,
  };

  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <>
      <div
        ref={containerRef}
        data-testid="board-viewport"
        style={{
          position: 'fixed',
          inset: 0,
          overflow: 'hidden',
          cursor: isPanning.current ? 'grabbing' : 'grab',
          touchAction: 'none',
          ...gridStyle,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onDoubleClick={handleDoubleClick}
      >
        <div
          data-testid="world-layer"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            transform: worldTransform,
            transformOrigin: '0 0',
          }}
        >
          {/* Origin marker */}
          <div
            data-testid="origin-marker"
            style={{
              position: 'absolute',
              left: -6,
              top: -6,
              width: 12,
              height: 12,
              pointerEvents: 'none',
            }}
          >
            <div style={{ position: 'absolute', left: 5, top: 0, width: 2, height: 12, background: '#999' }} />
            <div style={{ position: 'absolute', left: 0, top: 5, width: 12, height: 2, background: '#999' }} />
          </div>
          {props.children}
        </div>
      </div>
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
