import { useRef, useEffect, useState } from 'react';
import type { Camera, Point } from './camera';
import { GRID_SPACING_WORLD } from '../../shared/config';

interface BoardViewportProps {
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  onCreateStickyAt?: (p: Point) => void;
  onClearSelection?: () => void;
  /**
   * Story 7 (sel.marquee): shift+drag on empty space is a marquee, not a pan.
   * When provided, a primary pointerdown with `shiftKey` on empty space
   * enters marquee mode; a plain drag keeps panning exactly as before.
   */
  onMarqueeBegin?: (screen: Point) => void;
  onMarqueeMove?: (screen: Point) => void;
  onMarqueeEnd?: () => void;
  onMarqueeCancel?: () => void;
  /**
   * Receives the viewport container element. Gesture code must use THIS
   * element for pointer capture (same element as pan/marquee) — see
   * `useTransformGesture` for why capture must not be transferred between
   * elements.
   */
  onViewportEl?: (el: HTMLDivElement | null) => void;
  /** Story 9: active tool — when 'text', cursor is text and click creates text. */
  tool?: 'select' | 'text';
  /** Story 9: click with text tool active creates text at this screen point. */
  onCreateTextAt?: (p: Point) => void;
  children?: React.ReactNode;
}

export function BoardViewport({
  camera,
  beginPan,
  panMove,
  endPan,
  wheel,
  onCreateStickyAt,
  onClearSelection,
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  onViewportEl,
  tool,
  onCreateTextAt,
  children,
}: BoardViewportProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const movedRef = useRef(false);
  const lastPointRef = useRef<Point | null>(null);
  const onCreateStickyAtRef = useRef(onCreateStickyAt);
  onCreateStickyAtRef.current = onCreateStickyAt;
  const onClearSelectionRef = useRef(onClearSelection);
  onClearSelectionRef.current = onClearSelection;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const onCreateTextAtRef = useRef(onCreateTextAt);
  onCreateTextAtRef.current = onCreateTextAt;
  // Marquee callbacks live in refs: they change identity every render, and
  // re-subscribing the pointer effect on them would reset pan state.
  const marqueeRef = useRef(false);
  const marqueeBeginRef = useRef(onMarqueeBegin);
  marqueeBeginRef.current = onMarqueeBegin;
  const marqueeMoveRef = useRef(onMarqueeMove);
  marqueeMoveRef.current = onMarqueeMove;
  const marqueeEndRef = useRef(onMarqueeEnd);
  marqueeEndRef.current = onMarqueeEnd;
  const marqueeCancelRef = useRef(onMarqueeCancel);
  marqueeCancelRef.current = onMarqueeCancel;

  // Non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const LINE_HEIGHT = 16;
      const PAGE_HEIGHT = 100;
      const scale = e.deltaMode === 1 ? LINE_HEIGHT : e.deltaMode === 2 ? PAGE_HEIGHT : 1;
      const rect = el.getBoundingClientRect();
      const point: Point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      wheel({
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point,
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [wheel]);

  // Safari gesture events
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const gestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const gestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      const ratio = ge.scale / lastScale;
      lastScale = ge.scale;
      const rect = el.getBoundingClientRect();
      const point: Point = { x: ge.clientX - rect.left, y: ge.clientY - rect.top };
      const WHEEL_ZOOM_SENSITIVITY = 0.01;
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
    };
    el.addEventListener('gesturestart', gestureStart);
    el.addEventListener('gesturechange', gestureChange);
    return () => {
      el.removeEventListener('gesturestart', gestureStart);
      el.removeEventListener('gesturechange', gestureChange);
    };
  }, [wheel]);

  // Keyboard shortcuts
  useEffect(() => {
    // Keyboard handlers are managed by the parent via zoomStep/reset
    // This is a no-op placeholder for future use
  }, []);

  // Pointer handlers (using native event listeners for reliability)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      // Story 9: text tool active — click creates text, no pan/marquee.
      if (toolRef.current === 'text') {
        const rect = el.getBoundingClientRect();
        onCreateTextAtRef.current?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        return;
      }

      // Capture so pointerup is delivered even if the pointer leaves the
      // window mid-pan/marquee. Best-effort: synthetic pointer ids (e2e)
      // and jsdom may reject it.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      if (e.shiftKey && marqueeBeginRef.current) {
        // Story 7: shift+drag on empty space is a marquee, not a pan.
        marqueeRef.current = true;
        marqueeBeginRef.current({ x: e.clientX, y: e.clientY });
        return;
      }
      isPanningRef.current = true;
      movedRef.current = false;
      setIsPanning(true);
      beginPan({ x: e.clientX, y: e.clientY });
    };

    const onPointerMove = (e: PointerEvent) => {
      if (marqueeRef.current) {
        marqueeMoveRef.current?.({ x: e.clientX, y: e.clientY });
        return;
      }
      if (!isPanningRef.current || !lastPointRef.current) return;
      const dx = e.clientX - lastPointRef.current.x;
      const dy = e.clientY - lastPointRef.current.y;
      if (dx !== 0 || dy !== 0) movedRef.current = true;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      panMove({ x: e.clientX, y: e.clientY });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (marqueeRef.current) {
        marqueeRef.current = false;
        lastPointRef.current = null;
        marqueeEndRef.current?.();
        try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
        return;
      }
      try { el.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      const wasPanning = isPanningRef.current;
      isPanningRef.current = false;
      setIsPanning(false);
      lastPointRef.current = null;
      endPan();
      // A click on empty board space (no movement) clears the selection.
      if (wasPanning && !movedRef.current) {
        onClearSelectionRef.current?.();
      }
    };

    const onPointerCancel = (_e: PointerEvent) => {
      if (marqueeRef.current) {
        marqueeRef.current = false;
        lastPointRef.current = null;
        marqueeCancelRef.current?.();
        return;
      }
      isPanningRef.current = false;
      setIsPanning(false);
      lastPointRef.current = null;
      endPan();
    };

    const onDoubleClick = (e: MouseEvent) => {
      // Notes stop propagation on dblclick, so only empty space reaches here.
      if (e.target !== el) return;
      const rect = el.getBoundingClientRect();
      onCreateStickyAtRef.current?.({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [beginPan, panMove, endPan]);

  // Dot grid
  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const bgX = ((-camera.x * camera.zoom) % spacing + spacing) % spacing;
  const bgY = ((-camera.y * camera.zoom) % spacing + spacing) % spacing;

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        onViewportEl?.(el);
      }}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: isPanning ? 'grabbing' : tool === 'text' ? 'text' : 'grab',
        touchAction: 'none',
      }}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
        }}
      >
        {/* Origin crosshair marker at world (0,0) */}
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
        {children}
      </div>
    </div>
  );
}
