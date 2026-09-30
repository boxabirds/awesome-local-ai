import { useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { Point, Camera } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY, DRAG_THRESHOLD_PX } from '../../shared/config';

interface BoardViewportProps {
  camera: Camera;
  isPanning: boolean;
  onPointerDown: (p: Point) => void;
  onPointerMove: (p: Point) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onWheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  onKeyZoomIn: () => void;
  onKeyZoomOut: () => void;
  onKeyReset: () => void;
  /** A click (no drag) on empty board space — clears the selection. */
  onEmptyClick?: () => void;
  /** A double-click on empty board space (viewport-relative point) — creates a sticky note. */
  onCreateSticky?: (p: Point) => void;
  /** Story 7: Shift + drag on empty space draws a marquee (instead of panning). */
  onMarqueeBegin?: (p: Point) => void;
  onMarqueeMove?: (p: Point) => void;
  onMarqueeEnd?: () => void;
  onMarqueeCancel?: () => void;
  /** Story 9: text tool active — text cursor, clicks create text (no pan/marquee). */
  textToolActive?: boolean;
  /** Story 9: a text-tool click on empty space (viewport-relative point). */
  onCreateText?: (p: Point) => void;
  children?: ReactNode;
}

const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 120;

export function BoardViewport({
  camera,
  isPanning,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onKeyZoomIn,
  onKeyZoomOut,
  onKeyReset,
  onEmptyClick,
  onCreateSticky,
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  textToolActive = false,
  onCreateText,
  children,
}: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragModeRef = useRef<'none' | 'pan' | 'marquee' | 'text'>('none');
  const emptyDownRef = useRef<Point | null>(null);
  const textToolActiveRef = useRef(textToolActive);
  textToolActiveRef.current = textToolActive;
  const onCreateTextRef = useRef(onCreateText);
  onCreateTextRef.current = onCreateText;

  // Pointer drag
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button != null && e.button !== 0) return;
      // Only start pan when the target is the viewport or grid
      const target = e.target as HTMLElement;
      if (target !== containerRef.current && !target.classList.contains('board-grid')) {
        // Allow if it's a direct child of the viewport (like the world layer)
        // but not if it's a control
        if (target.closest('[data-testid="zoom-controls"]')) return;
        if (target.closest('[data-testid="navigation-hint"]')) return;
      }
      // Story 9: text tool — no pan, no marquee. A click (no movement) creates text.
      if (textToolActiveRef.current) {
        dragModeRef.current = 'text';
        emptyDownRef.current = { x: e.clientX, y: e.clientY };
        try {
          containerRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // jsdom doesn't support pointer capture
        }
        return;
      }
      // Story 7: Shift + pointer-down on empty space starts a marquee, not a pan.
      const mode: 'pan' | 'marquee' = e.shiftKey && onMarqueeBegin ? 'marquee' : 'pan';
      dragModeRef.current = mode;
      emptyDownRef.current = { x: e.clientX, y: e.clientY };
      try {
        containerRef.current?.setPointerCapture(e.pointerId);
      } catch {
        // jsdom doesn't support pointer capture
      }
      if (mode === 'marquee' && onMarqueeBegin) {
        onMarqueeBegin({ x: e.clientX, y: e.clientY });
      } else {
        onPointerDown({ x: e.clientX, y: e.clientY });
      }
    },
    [onPointerDown, onMarqueeBegin]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (dragModeRef.current === 'marquee') {
        onMarqueeMove?.({ x: e.clientX, y: e.clientY });
        return;
      }
      if (dragModeRef.current !== 'pan') return;
      onPointerMove({ x: e.clientX, y: e.clientY });
    },
    [onPointerMove, onMarqueeMove]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragModeRef.current === 'text') {
        // Story 9: a text-tool click (no movement) on empty space creates text.
        dragModeRef.current = 'none';
        const down = emptyDownRef.current;
        emptyDownRef.current = null;
        try {
          containerRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        if (down && onCreateTextRef.current) {
          const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
          if (moved < DRAG_THRESHOLD_PX) {
            const rect = containerRef.current?.getBoundingClientRect();
            if (rect) {
              onCreateTextRef.current({ x: down.x - rect.left, y: down.y - rect.top });
            }
          }
        }
        return;
      }
      if (dragModeRef.current === 'marquee') {
        dragModeRef.current = 'none';
        emptyDownRef.current = null;
        try {
          containerRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        onMarqueeEnd?.();
        return;
      }
      if (dragModeRef.current !== 'pan') return;
      dragModeRef.current = 'none';
      const down = emptyDownRef.current;
      emptyDownRef.current = null;
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onPointerUp();
      // A short press without movement on empty space clears the selection.
      if (down && onEmptyClick) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved < DRAG_THRESHOLD_PX) onEmptyClick();
      }
    },
    [onPointerUp, onEmptyClick, onMarqueeEnd]
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (dragModeRef.current === 'text') {
        dragModeRef.current = 'none';
        emptyDownRef.current = null;
        return;
      }
      if (dragModeRef.current === 'marquee') {
        dragModeRef.current = 'none';
        emptyDownRef.current = null;
        onMarqueeCancel?.();
        return;
      }
      if (dragModeRef.current !== 'pan') return;
      dragModeRef.current = 'none';
      emptyDownRef.current = null;
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onPointerCancel();
    },
    [onPointerCancel, onMarqueeCancel]
  );

  // Double-click on empty board space creates a sticky note centred there.
  // A double-click on a note is handled (and stopped) by the note itself.
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Story 9: the text tool owns empty-space clicks; no sticky on double-click.
      if (textToolActiveRef.current) return;
      if (!onCreateSticky) return;
      const target = e.target as HTMLElement;
      if (target !== containerRef.current && !target.classList.contains('board-grid')) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      onCreateSticky({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [onCreateSticky]
  );

  // Wheel (non-passive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      let dx = e.deltaX;
      let dy = e.deltaY;

      if (e.deltaMode === 1) {
        dx *= WHEEL_LINE_DELTA_PX;
        dy *= WHEEL_LINE_DELTA_PX;
      } else if (e.deltaMode === 2) {
        dx *= WHEEL_PAGE_DELTA_PX;
        dy *= WHEEL_PAGE_DELTA_PX;
      }

      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      onWheel({ deltaX: dx, deltaY: dy, ctrlOrMeta: e.ctrlKey || e.metaKey, point });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onWheel]);

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
      const gesture = e as unknown as { scale: number; clientX: number; clientY: number };
      const scaleRatio = gesture.scale / lastScale;
      lastScale = gesture.scale;

      const rect = el.getBoundingClientRect();
      const point: Point = {
        x: (gesture.clientX || 0) - rect.left,
        y: (gesture.clientY || 0) - rect.top,
      };

      const deltaY = -Math.log(scaleRatio) / WHEEL_ZOOM_SENSITIVITY;
      onWheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };

    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, [onWheel]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        onKeyZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        onKeyZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        onKeyReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onKeyZoomIn, onKeyZoomOut, onKeyReset]);

  // Compute grid background
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = -((camera.x * camera.zoom) % gridSpacing);
  const gridOffsetY = -((camera.y * camera.zoom) % gridSpacing);

  const worldTransform = `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`;

  return (
    <div
      ref={containerRef}
      className="board-viewport"
      data-testid="board-viewport"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        cursor: textToolActive ? 'text' : isPanning ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      {/* Dot grid */}
      <div
        className="board-grid"
        data-testid="board-grid"
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
          backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
          pointerEvents: 'none',
        }}
      />

      {/* World layer */}
      <div
        className="world-layer"
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
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

        {children}
      </div>
    </div>
  );
}
