import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraContext } from './CameraContext';
import { screenToWorld, type Point } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '@/shared/config';

export interface BoardViewportProps {
  children?: React.ReactNode;
  /** Double-click on empty board space: create an object at this world point. */
  onCreateStickyAt?: (world: Point) => void;
  /** Click (press without movement) on empty board space: clear the selection. */
  onClearSelection?: () => void;
}

export function BoardViewport(props: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset } = useCameraContext();

  const isPanningRef = useRef(false);
  const downPosRef = useRef<Point | null>(null);
  const [cursorStyle, setCursorStyle] = useState('default');

  // ResizeObserver for viewport size
  const [size, setSize] = useState({ width: 0, height: 0 });
  void size; // used implicitly for layout; camera is managed by App

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pointer events
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only start pan when clicking the viewport or world layer (not child objects with data-no-pan)
      const target = e.target as HTMLElement;
      if (target.dataset?.noPan) return;
      isPanningRef.current = true;
      downPosRef.current = { x: e.clientX, y: e.clientY };
      setCursorStyle('grabbing');
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      beginPan({ x: e.clientX, y: e.clientY });
    },
    [beginPan],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      panMove({ x: e.clientX, y: e.clientY });
    },
    [panMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setCursorStyle('default');
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      const down = downPosRef.current;
      downPosRef.current = null;
      endPan();
      // A press on empty space without movement is a click: clear the selection.
      if (down !== null && down.x === e.clientX && down.y === e.clientY) {
        props.onClearSelection?.();
      }
    },
    [endPan, props.onClearSelection],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setCursorStyle('default');
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      endPan();
    },
    [endPan],
  );

  // Non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const LINE_HEIGHT = 16;
    const PAGE_HEIGHT = 100;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        dx *= LINE_HEIGHT;
        dy *= LINE_HEIGHT;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        dx *= PAGE_HEIGHT;
        dy *= PAGE_HEIGHT;
      }
      const rect = el.getBoundingClientRect();
      wheel({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let lastScale = 1;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      const factor = ge.scale / lastScale;
      lastScale = ge.scale;
      if (factor !== 1 && Number.isFinite(factor) && factor > 0) {
        const rect = el.getBoundingClientRect();
        const point = { x: ge.clientX - rect.left, y: ge.clientY - rect.top };
        const deltaY = -Math.log(factor) / WHEEL_ZOOM_SENSITIVITY;
        wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
      }
    };

    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, [wheel]);

  // Double-click on empty board space creates a sticky note centred on the
  // point (notes stop propagation of their own dblclick, so this only fires
  // for the viewport/grid background).
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== containerRef.current) return;
      const create = props.onCreateStickyAt;
      if (!create) return;
      const rect = containerRef.current.getBoundingClientRect();
      create(screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
    },
    [camera, props.onCreateStickyAt],
  );

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

  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridPosX = -((camera.x * camera.zoom) % gridSpacing);
  const gridPosY = -((camera.y * camera.zoom) % gridSpacing);

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: cursorStyle,
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${gridPosX}px ${gridPosY}px`,
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          width: 0,
          height: 0,
        }}
      >
        {/* Origin marker */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            top: -4,
            left: -4,
            width: 8,
            height: 8,
            border: '1.5px solid #666',
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        />
        {props.children}
      </div>
    </div>
  );
}
