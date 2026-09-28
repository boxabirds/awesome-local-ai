import { useRef, useEffect, useCallback, type ReactNode, type JSX } from 'react';
import type { Camera, Point } from './camera';
import { screenToWorld } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '../../shared/config';

// Delta mode conversion constants
const LINE_HEIGHT = 16;
const PAGE_FACTOR = 0.9;

function convertDelta(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * LINE_HEIGHT;
  if (deltaMode === 2) return delta * PAGE_FACTOR * window.innerHeight;
  return delta;
}

export interface BoardViewportProps {
  children?: ReactNode;
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomStepIn: () => void;
  zoomStepOut: () => void;
  reset: () => void;
  setCamera: (cam: Camera) => void;
  /** Story 2: double-click on empty board space creates a sticky note centred on that world point. */
  onCreateStickyAt: (world: Point) => void;
  /** Story 2: a click (press+release without movement) on empty board space clears the selection. */
  onEmptyClick: () => void;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);

  // ResizeObserver (viewport size tracked for future use)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {});
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Use refs for the handlers to avoid stale closures in event listeners
  const camRef = useRef(props);
  camRef.current = props;

  // Tracks a press that started on empty board space, so a release without
  // meaningful movement counts as a click (clears the selection, story 2).
  const emptyPressRef = useRef<{ x: number; y: number } | null>(null);

  // Pointer drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const container = containerRef.current;
    if (!container) return;
    if (target === container || target === worldRef.current) {
      container.setPointerCapture(e.pointerId);
      emptyPressRef.current = { x: e.clientX, y: e.clientY };
      const rect = container.getBoundingClientRect();
      camRef.current.beginPan({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    camRef.current.panMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (container) container.releasePointerCapture(e.pointerId);
    camRef.current.endPan();
    const press = emptyPressRef.current;
    emptyPressRef.current = null;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 5) {
      camRef.current.onEmptyClick();
    }
  }, []);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    const container = containerRef.current;
    if (container) container.releasePointerCapture(e.pointerId);
    emptyPressRef.current = null;
    camRef.current.endPan();
  }, []);

  // Double-click on empty board space creates a sticky note centred there
  // (sticky.create_dblclick). Dblclicks on notes are stopped by the notes
  // themselves, so only empty space reaches this handler.
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const container = containerRef.current;
    if (!container) return;
    if (target !== container && target !== worldRef.current) return;
    const rect = container.getBoundingClientRect();
    const world = screenToWorld(camRef.current.camera, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
    camRef.current.onCreateStickyAt(world);
  }, []);

  // Wheel handler (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const deltaX = convertDelta(e.deltaX, e.deltaMode);
      const deltaY = convertDelta(e.deltaY, e.deltaMode);
      camRef.current.wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Safari gesture handlers
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
      const ge = e as any;
      const scale = ge.scale as number;
      if (scale === 0) return;
      const ratio = scale / lastScale;
      lastScale = scale;
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      camRef.current.wheel({
        deltaX: 0,
        deltaY,
        ctrlOrMeta: true,
        point: { x: 0, y: 0 },
      });
    };

    el.addEventListener('gesturestart', onGestureStart as any, { passive: false } as any);
    el.addEventListener('gesturechange', onGestureChange as any, { passive: false } as any);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as any);
      el.removeEventListener('gesturechange', onGestureChange as any);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          camRef.current.zoomStepIn();
        } else if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          camRef.current.zoomStepOut();
        } else if (e.key === '0') {
          e.preventDefault();
          camRef.current.reset();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Expose test hook (only in test mode)
  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      (window as any).__vidi6 = {
        setCamera: (c: any) => camRef.current.setCamera(c),
      };
    }
  }, []);

  // Compute grid style
  const { zoom, x: camX, y: camY } = props.camera;
  const gridSpacing = GRID_SPACING_WORLD * zoom;
  const gridOffsetX = ((-camX * zoom) % gridSpacing + gridSpacing) % gridSpacing;
  const gridOffsetY = ((-camY * zoom) % gridSpacing + gridSpacing) % gridSpacing;

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: 'grab',
        backgroundColor: '#f8f9fa',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      <div
        ref={worldRef}
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${zoom}) translate(${-camX}px, ${-camY}px)`,
          transformOrigin: '0 0',
        }}
      >
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: -4,
            top: -4,
            width: 8,
            height: 8,
            border: '1px solid #666',
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        />
        {props.children}
      </div>
    </div>
  );
}
