// src/client/canvas/BoardViewport.tsx
import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode, PointerEvent as ReactPointerEvent } from 'react';
import type { Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';

export interface BoardViewportProps {
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  onDblClickEmpty?: (screenPoint: Point) => void;
  onClickEmpty?: () => void;
  onClickEmptyWithPoint?: (screenPoint: Point) => void;
  onMarqueeBegin?: (screenPoint: Point) => void;
  onMarqueeMove?: (screenPoint: Point) => void;
  onMarqueeEnd?: () => void;
  onMarqueeCancel?: () => void;
  cursorStyle?: string;
  textToolActive?: boolean;
  children?: ReactNode;
}

const WHEEL_LINE_DELTA = 16;
const WHEEL_PAGE_DELTA = 100;

export function BoardViewport(props: BoardViewportProps): ReactElement {
  const { camera, beginPan, panMove, endPan, wheel, zoomIn, zoomOut, reset, onDblClickEmpty, onClickEmpty, onClickEmptyWithPoint, onMarqueeBegin, onMarqueeMove, onMarqueeEnd, onMarqueeCancel, cursorStyle, textToolActive } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const isMarqueeRef = useRef(false);
  const didPanRef = useRef(false);

  // Pointer drag handling
  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('board-viewport') && !target.classList.contains('board-grid')) {
      return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // Text tool active: don't pan or marquee on empty space
    if (textToolActive) {
      return;
    }

    // Shift+drag on empty space → marquee
    if (e.shiftKey && onMarqueeBegin) {
      isMarqueeRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onMarqueeBegin(screenPoint);
      return;
    }

    // Plain drag → pan
    isPanningRef.current = true;
    didPanRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    beginPan(screenPoint);
  }, [beginPan, onMarqueeBegin, textToolActive]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    if (isMarqueeRef.current && onMarqueeMove) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      onMarqueeMove(screenPoint);
      return;
    }

    if (!isPanningRef.current) return;
    didPanRef.current = true;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    panMove({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, [panMove, onMarqueeMove]);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* already released */ }
      onMarqueeEnd?.();
      return;
    }

    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
    endPan();
    // If we didn't actually pan (no movement), treat as click on empty space
    if (!didPanRef.current && onClickEmpty) {
      const target = e.target as HTMLElement;
      if (target.classList.contains('board-viewport') || target.classList.contains('board-grid')) {
        onClickEmpty();
      }
    }
  }, [endPan, onClickEmpty, onMarqueeEnd]);

  // Click handler for text tool (creates text at click point)
  const onClick = useCallback((e: React.MouseEvent) => {
    if (!textToolActive) return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains('board-viewport') && !target.classList.contains('board-grid')) {
      return;
    }
    const rect = containerRef.current!.getBoundingClientRect();
    const screenPoint: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    onClickEmptyWithPoint?.(screenPoint);
  }, [textToolActive, onClickEmptyWithPoint]);

  const onPointerCancel = useCallback((e: ReactPointerEvent) => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* already released */ }
      onMarqueeCancel?.();
      return;
    }

    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
    endPan();
  }, [endPan, onMarqueeCancel]);

  const onLostPointerCapture = useCallback(() => {
    if (isMarqueeRef.current) {
      isMarqueeRef.current = false;
      onMarqueeCancel?.();
      return;
    }
    if (!isPanningRef.current) return;
    isPanningRef.current = false;
    endPan();
  }, [endPan, onMarqueeCancel]);

  // Wheel handling (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();

      let deltaX = e.deltaX;
      let deltaY = e.deltaY;

      if (e.deltaMode === 1) {
        deltaX *= WHEEL_LINE_DELTA;
        deltaY *= WHEEL_LINE_DELTA;
      } else if (e.deltaMode === 2) {
        deltaX *= WHEEL_PAGE_DELTA;
        deltaY *= WHEEL_PAGE_DELTA;
      }

      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheel({ deltaX, deltaY, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wheel]);

  // Safari gesture handling
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onGestureStart = (e: Event) => {
      e.preventDefault();
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as unknown as { scale: number; clientX: number; clientY: number };
      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: gesture.clientX - rect.left,
        y: gesture.clientY - rect.top,
      };
      wheel({ deltaX: 0, deltaY: -Math.log(gesture.scale) / 0.01, ctrlOrMeta: true, point });
    };

    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [wheel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomIn, zoomOut, reset]);

  // Grid background
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgX = ((-camera.x * camera.zoom) % spacing + spacing) % spacing;
  const bgY = ((-camera.y * camera.zoom) % spacing + spacing) % spacing;

  // World layer transform
  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <div
      ref={containerRef}
      className="board-viewport"
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        cursor: cursorStyle ?? 'grab',
        backgroundImage: `radial-gradient(circle, #ccc 1px, transparent 1px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onClick={onClick}
      onDoubleClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('board-viewport') || target.classList.contains('board-grid')) {
          e.stopPropagation();
          const rect = containerRef.current!.getBoundingClientRect();
          onDblClickEmpty?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      }}
    >
      <div
        className="board-grid"
        data-testid="board-grid"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
        }}
      />
      <div
        className="board-world"
        data-testid="board-world"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: worldTransform,
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
          <div style={{ position: 'absolute', left: 7, top: 0, width: 2, height: 16, background: '#999' }} />
          <div style={{ position: 'absolute', left: 0, top: 7, width: 16, height: 2, background: '#999' }} />
        </div>
        {props.children}
      </div>
    </div>
  );
}
