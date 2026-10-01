import { useRef, useEffect, useCallback, type JSX } from 'react';
import type { Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';
import type { Tool } from '../board/useTool';

export interface BoardViewportProps {
  children?: React.ReactNode;
  camera: Camera;
  beginPan(p: Point): void;
  panMove(p: Point): void;
  endPan(): void;
  wheel(e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }): void;
  zoomStep(dir: 'in' | 'out'): void;
  reset(): void;
  onDoubleClickEmpty?(p: Point): void;
  onPointerDownEmpty?(): void;
  /** Active tool (story 9). While 'text', board clicks create text. */
  tool?: Tool;
  /**
   * Screen-space overlay rendered above the world layer (story 11: the Pen
   * tool preview and cursor). Not transformed by the camera.
   */
  overlayChildren?: React.ReactNode;
  /** Text tool: pointerdown anywhere on the board (screen coords). */
  onTextToolClick?(p: Point): void;
  onMarqueeBegin?(p: Point): void;
  onMarqueeMove?(p: Point): void;
  onMarqueeEnd?(): void;
  onMarqueeCancel?(): void;
}

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const isMarqueeingRef = useRef(false);
  const gestureScaleRef = useRef(1);
  const pointerDownWasEmptyRef = useRef(false);
  const pointerDownMovedRef = useRef(false);

  // Pointer events for drag panning and marquee
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // While the Pen tool is active, drags draw strokes (routed to the Pen
      // tool overlay); they never pan the board (pen.navigation).
      if (props.tool === 'pen') return;

      const target = e.target as HTMLElement;
      const isOnNote = target.closest('[data-note-id]');
      const isOnToolbar = target.closest('[data-testid="toolbar"]') || target.closest('[data-testid="note-toolbar"]') || target.closest('[data-testid="selection-bar"]');
      const isOnHandle = target.closest('[data-testid^="handle-"]');
      if (isOnNote || isOnToolbar || isOnHandle) return;

      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      pointerDownWasEmptyRef.current = true;
      pointerDownMovedRef.current = false;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (e.shiftKey) {
        // Marquee selection
        isMarqueeingRef.current = true;
        props.onMarqueeBegin?.(screenPoint);
      } else {
        // Pan
        isPanningRef.current = true;
        props.beginPan(screenPoint);
      }
    },
    [props.beginPan, props.onMarqueeBegin],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (isPanningRef.current) {
        pointerDownMovedRef.current = true;
        props.panMove(screenPoint);
      } else if (isMarqueeingRef.current) {
        pointerDownMovedRef.current = true;
        props.onMarqueeMove?.(screenPoint);
      }
    },
    [props.panMove, props.onMarqueeMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
        props.endPan();
        // If pointer down was on empty space and we didn't pan much, clear selection
        if (pointerDownWasEmptyRef.current && !pointerDownMovedRef.current) {
          props.onPointerDownEmpty?.();
        }
        pointerDownWasEmptyRef.current = false;
        pointerDownMovedRef.current = false;
      } else if (isMarqueeingRef.current) {
        isMarqueeingRef.current = false;
        props.onMarqueeEnd?.();
        pointerDownWasEmptyRef.current = false;
        pointerDownMovedRef.current = false;
      }
    },
    [props.endPan, props.onPointerDownEmpty, props.onMarqueeEnd],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }

      if (isPanningRef.current) {
        isPanningRef.current = false;
        props.endPan();
        pointerDownWasEmptyRef.current = false;
        pointerDownMovedRef.current = false;
      } else if (isMarqueeingRef.current) {
        isMarqueeingRef.current = false;
        props.onMarqueeCancel?.();
        pointerDownWasEmptyRef.current = false;
        pointerDownMovedRef.current = false;
      }
    },
    [props.endPan, props.onMarqueeCancel],
  );

  // Double-click handler for creating notes on empty space
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const isOnNote = target.closest('[data-note-id]');
      const isOnToolbar = target.closest('[data-testid="toolbar"]') || target.closest('[data-testid="note-toolbar"]') || target.closest('[data-testid="selection-bar"]');
      if (isOnNote || isOnToolbar) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      props.onDoubleClickEmpty?.(point);
    },
    [props.onDoubleClickEmpty],
  );

  // Text tool (story 9): while active, any pointerdown on the board creates
  // a text object at that point (even over existing objects). Toolbar,
  // selection bar and handles are excluded. Capture phase so object handlers
  // never see the event. Empty-space pointerdowns neither pan nor marquee.
  useEffect(() => {
    if (props.tool !== 'text') return;
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-testid="toolbar"]')) return;
      if (target.closest('[data-testid="selection-bar"]')) return;
      if (target.closest('[data-testid^="handle-"]')) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      props.onTextToolClick?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    el.addEventListener('pointerdown', handler, { capture: true });
    return () => el.removeEventListener('pointerdown', handler, { capture: true });
  }, [props.tool, props.onTextToolClick]);

  // Wheel event (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;

      if (e.deltaMode === 1) {
        deltaX *= 16;
        deltaY *= 16;
      } else if (e.deltaMode === 2) {
        deltaX *= 100;
        deltaY *= 100;
      }

      props.wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [props.wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };

    const handleGestureChange = (e: Event) => {
      e.preventDefault();
      const gestureEvent = e as unknown as { scale: number };
      const scale = gestureEvent.scale;
      if (!scale || scale === gestureScaleRef.current) return;

      const factor = scale / gestureScaleRef.current;
      gestureScaleRef.current = scale;

      const rect = el.getBoundingClientRect();
      const center: Point = { x: rect.width / 2, y: rect.height / 2 };
      const deltaY = -Math.log(factor) / 0.01;
      props.wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point: center });
    };

    const handleGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = 1;
    };

    el.addEventListener('gesturestart', handleGestureStart);
    el.addEventListener('gesturechange', handleGestureChange);
    el.addEventListener('gestureend', handleGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', handleGestureStart);
      el.removeEventListener('gesturechange', handleGestureChange);
      el.removeEventListener('gestureend', handleGestureEnd);
    };
  }, [props.wheel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        props.zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        props.zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        props.reset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.zoomStep, props.reset]);

  // Compute grid background
  const spacing = GRID_SPACING_WORLD * props.camera.zoom;
  const bgX = -((props.camera.x * props.camera.zoom) % spacing);
  const bgY = -((props.camera.y * props.camera.zoom) % spacing);

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: props.tool === 'text' ? 'text' : 'grab',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundColor: '#fafafa',
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
          width: '100%',
          height: '100%',
          transform: `scale(${props.camera.zoom}) translate(${-props.camera.x}px, ${-props.camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {/* Origin marker (crosshair at world 0,0) */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            left: -8,
            top: -8,
            width: 16,
            height: 16,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 7,
              top: 0,
              width: 2,
              height: 16,
              backgroundColor: '#999',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 7,
              width: 16,
              height: 2,
              backgroundColor: '#999',
            }}
          />
        </div>
        {props.children}
      </div>
      {props.overlayChildren}
    </div>
  );
}
