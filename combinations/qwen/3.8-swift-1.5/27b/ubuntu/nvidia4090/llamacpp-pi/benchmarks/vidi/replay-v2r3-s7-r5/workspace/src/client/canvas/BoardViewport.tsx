import { useRef, useEffect, useState } from 'react';
import type { Camera, Point } from './camera';
import { screenToWorld } from './camera';
import { normalizeRect, type Rect } from '../../shared/geometry';
import { GRID_SPACING_WORLD, DRAG_THRESHOLD_PX } from '../../shared/config';

interface BoardViewportProps {
  camera: Camera;
  beginPan: (p: Point) => void;
  panMove: (p: Point) => void;
  endPan: () => void;
  wheel: (e: { deltaX: number; deltaY: number; ctrlOrMeta: boolean; point: Point }) => void;
  onCreateStickyAt?: (p: Point) => void;
  onClearSelection?: () => void;
  /** Shift+drag marquee commit: fully-inside objects, additive. */
  onMarqueeSelect?: (rect: Rect, additive: boolean) => void;
  children?: React.ReactNode;
}

type MarqueeState =
  | { kind: 'idle' }
  | { kind: 'pending'; pointerId: number; startScreen: Point; startWorld: Point; additive: boolean }
  | { kind: 'active'; pointerId: number; startWorld: Point; additive: boolean; rect: Rect };

/**
 * The board viewport: dot grid, world layer, pan/zoom (story 1), empty-space
 * click clears the selection, and Shift+drag marquee selection (story 7).
 * A plain drag on empty space pans exactly as before — no marquee.
 */
export function BoardViewport({
  camera,
  beginPan,
  panMove,
  endPan,
  wheel,
  onCreateStickyAt,
  onClearSelection,
  onMarqueeSelect,
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
  const onMarqueeSelectRef = useRef(onMarqueeSelect);
  onMarqueeSelectRef.current = onMarqueeSelect;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // Marquee state (world units; converted on every move so zoom during the
  // drag is harmless).
  const marqueeRef = useRef<MarqueeState>({ kind: 'idle' });
  const [marqueeRect, setMarqueeRect] = useState<Rect | null>(null);

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

  // Pointer handlers (using native event listeners for reliability)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const screenPoint = (e: PointerEvent): Point => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);

      // Shift+drag on empty space: marquee selection (no pan).
      if (e.shiftKey) {
        const sp = screenPoint(e);
        const w = screenToWorld(cameraRef.current, sp);
        marqueeRef.current = {
          kind: 'pending',
          pointerId: e.pointerId,
          startScreen: sp,
          startWorld: w,
          additive: true,
        };
        return;
      }

      isPanningRef.current = true;
      movedRef.current = false;
      setIsPanning(true);
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      beginPan({ x: e.clientX, y: e.clientY });
    };

    const onPointerMove = (e: PointerEvent) => {
      const m = marqueeRef.current;
      if (m.kind !== 'idle' && e.pointerId === m.pointerId) {
        const sp = screenPoint(e);
        if (m.kind === 'pending') {
          const dist = Math.hypot(sp.x - m.startScreen.x, sp.y - m.startScreen.y);
          if (dist < DRAG_THRESHOLD_PX) return;
          const curWorld = screenToWorld(cameraRef.current, sp);
          const rect = normalizeRect(m.startWorld, curWorld);
          marqueeRef.current = {
            kind: 'active',
            pointerId: m.pointerId,
            startWorld: m.startWorld,
            additive: m.additive,
            rect,
          };
          setMarqueeRect(rect);
        } else {
          const curWorld = screenToWorld(cameraRef.current, sp);
          const rect = normalizeRect(m.startWorld, curWorld);
          marqueeRef.current = { ...m, rect };
          setMarqueeRect(rect);
        }
        return;
      }

      if (!isPanningRef.current || !lastPointRef.current) return;
      const dx = e.clientX - lastPointRef.current.x;
      const dy = e.clientY - lastPointRef.current.y;
      if (dx !== 0 || dy !== 0) movedRef.current = true;
      lastPointRef.current = { x: e.clientX, y: e.clientY };
      panMove({ x: e.clientX, y: e.clientY });
    };

    const onPointerUp = (_e: PointerEvent) => {
      const m = marqueeRef.current;
      if (m.kind !== 'idle') {
        marqueeRef.current = { kind: 'idle' };
        setMarqueeRect(null);
        if (m.kind === 'active') {
          onMarqueeSelectRef.current?.(m.rect, m.additive);
        }
        // A shift+click without drag changes nothing (additive empty rect).
        return;
      }

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

    const onPointerCancel = (e: PointerEvent) => {
      const m = marqueeRef.current;
      if (m.kind !== 'idle' && e.pointerId === m.pointerId) {
        // Cancel: the selection is unchanged.
        marqueeRef.current = { kind: 'idle' };
        setMarqueeRect(null);
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
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: isPanning ? 'grabbing' : 'grab',
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
        {marqueeRect && (
          <div
            data-testid="marquee-rect"
            style={{
              position: 'absolute',
              left: marqueeRect.x,
              top: marqueeRect.y,
              width: marqueeRect.width,
              height: marqueeRect.height,
              background: 'rgba(21, 101, 192, 0.12)',
              border: '1px solid #1565C0',
              pointerEvents: 'none',
            }}
          />
        )}
        {children}
      </div>
    </div>
  );
}
