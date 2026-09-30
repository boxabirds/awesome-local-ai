import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  DRAG_THRESHOLD_PX,
  GRID_MIN_SCREEN_SPACING_PX,
  GRID_SPACING_WORLD,
  WHEEL_LINE_HEIGHT_PX,
} from '../../shared/config';
import type { Marquee } from '../board/Marquee';
import { screenToWorld, type Camera, type Point } from './camera';
import { useCameraContext } from './useCamera';

const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LOD_MULTIPLIER = 2;

/** Positive modulo, so grid offsets are stable for negative coordinates. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * Dot grid placement: dots sit at world multiples of the grid spacing. When
 * zoomed far out the spacing doubles until dots are at least
 * GRID_MIN_SCREEN_SPACING_PX apart, so the grid never turns into a haze.
 */
export function gridStyle(cam: Camera): { size: number; offsetX: number; offsetY: number } {
  let spacingWorld = GRID_SPACING_WORLD;
  while (spacingWorld * cam.zoom < GRID_MIN_SCREEN_SPACING_PX) spacingWorld *= LOD_MULTIPLIER;
  const size = spacingWorld * cam.zoom;
  // Modulo in world units first keeps precision far from the origin.
  const offsetX = mod(-cam.x, spacingWorld) * cam.zoom - size / 2;
  const offsetY = mod(-cam.y, spacingWorld) * cam.zoom - size / 2;
  return { size, offsetX, offsetY };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

interface GestureLikeEvent extends Event {
  scale?: number;
  clientX?: number;
  clientY?: number;
}

export function BoardViewport(props: {
  children?: ReactNode;
  /** Double-click on empty board space, in world coordinates. */
  onEmptyDoubleClick?(world: Point): void;
  /** Press and release on empty board space without dragging. */
  onEmptyClick?(): void;
  /** Shift+drag on empty board space draws this box selection instead of panning (story 7). */
  marquee?: Marquee;
  /** Screen-space layer above the world (selection box, handles, selection bar). */
  overlay?: ReactNode;
  /**
   * Active tool (stories 9–10). With 'text', a press anywhere on the board calls
   * `onToolClick`; the Shape and Connector tools render their own layer in `overlay`.
   */
  tool?: string;
  /** Press with a creating tool active, in world coordinates (also on top of objects). */
  onToolClick?(world: Point): void;
}) {
  const { api, onViewportResize } = useCameraContext();
  const { camera } = api;
  const ref = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const modeRef = useRef<'pan' | 'marquee'>('pan');
  const pointerIdRef = useRef<number | null>(null);
  const downPointRef = useRef<Point | null>(null);
  const lastHoverRef = useRef<Point | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  // Viewport size.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      onViewportResize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onViewportResize]);

  // Non-passive wheel + Safari gesture listeners (React's onWheel is passive).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const localPoint = (clientX: number, clientY: number): Point => {
      const rect = el.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let unit = 1;
      if (e.deltaMode === DOM_DELTA_LINE) unit = WHEEL_LINE_HEIGHT_PX;
      else if (e.deltaMode === DOM_DELTA_PAGE) unit = el.clientHeight;
      apiRef.current.wheel({
        deltaX: e.deltaX * unit,
        deltaY: e.deltaY * unit,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: localPoint(e.clientX, e.clientY),
      });
    };
    let lastScale = 1;
    const gesturePoint = (e: GestureLikeEvent): Point => {
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        return localPoint(e.clientX, e.clientY);
      }
      return lastHoverRef.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    };
    const onGestureStart = (e: GestureLikeEvent) => {
      e.preventDefault();
      lastScale = typeof e.scale === 'number' && e.scale > 0 ? e.scale : 1;
    };
    const onGestureChange = (e: GestureLikeEvent) => {
      e.preventDefault();
      if (typeof e.scale !== 'number' || !(e.scale > 0)) return;
      const ratio = e.scale / lastScale;
      lastScale = e.scale;
      apiRef.current.zoomAt(gesturePoint(e), ratio);
    };
    const onGestureEnd = (e: Event) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // Keyboard shortcuts: Ctrl/Cmd + = / − / 0.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        apiRef.current.zoomStep('in');
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault();
        apiRef.current.zoomStep('out');
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault();
        apiRef.current.reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toLocal = (e: React.MouseEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const endPan = () => {
    if (pointerIdRef.current === null) return;
    pointerIdRef.current = null;
    if (modeRef.current === 'marquee') {
      setSelecting(false);
      return;
    }
    api.endPan();
    setPanning(false);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only empty board space starts a pan; objects (later stories) stop propagation.
    if (e.target !== e.currentTarget) return;
    if (e.button !== 0 || pointerIdRef.current !== null) return;
    e.currentTarget.focus({ preventScroll: true });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture may be unavailable (e.g. synthetic events); dragging still works.
    }
    pointerIdRef.current = e.pointerId;
    downPointRef.current = toLocal(e);
    if (e.shiftKey && props.marquee) {
      modeRef.current = 'marquee';
      props.marquee.begin(downPointRef.current);
      setSelecting(true);
      return;
    }
    modeRef.current = 'pan';
    api.beginPan(downPointRef.current);
    setPanning(true);
  };

  // Text tool: a press on the board (empty space or an object, not the overlay's
  // handles and toolbars) places text there; nothing pans, selects or drags.
  const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (props.tool !== 'text' || e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest('.board-overlay')) return;
    e.stopPropagation();
    e.preventDefault(); // focus goes to the new text's editor, not the board
    props.onToolClick?.(screenToWorld(apiRef.current.camera, toLocal(e)));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toLocal(e);
    lastHoverRef.current = p;
    if (pointerIdRef.current !== e.pointerId) return;
    if (modeRef.current === 'marquee') props.marquee?.move(p);
    else api.panMove(p);
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const down = downPointRef.current;
    downPointRef.current = null;
    const mode = modeRef.current;
    endPan();
    if (mode === 'marquee') {
      if (e.type === 'pointerup') {
        props.marquee?.move(toLocal(e));
        props.marquee?.end();
      } else {
        props.marquee?.cancel();
      }
      return;
    }
    if (e.type !== 'pointerup' || !down) return;
    const p = toLocal(e);
    if (Math.hypot(p.x - down.x, p.y - down.y) < DRAG_THRESHOLD_PX) props.onEmptyClick?.();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only empty board space creates; objects stop propagation of their own dblclick.
    if (e.target !== e.currentTarget) return;
    const rect = ref.current!.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    props.onEmptyDoubleClick?.(screenToWorld(apiRef.current.camera, p));
  };

  const grid = gridStyle(camera);

  return (
    <div
      ref={ref}
      className={`board-viewport${panning ? ' is-panning' : ''}${props.tool === 'text' ? ' is-text-tool' : ''}`}
      data-testid="board-viewport"
      data-state={panning ? 'panning' : selecting ? 'marquee' : 'idle'}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-tool={props.tool ?? 'select'}
      role="application"
      aria-label="Board"
      aria-roledescription="whiteboard"
      tabIndex={0}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={onDoubleClick}
      style={{
        backgroundSize: `${grid.size}px ${grid.size}px`,
        backgroundPosition: `${grid.offsetX}px ${grid.offsetY}px`,
      }}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          ['--zoom' as string]: camera.zoom,
        }}
      >
        <div className="origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {props.children}
      </div>
      {props.overlay !== undefined && (
        <div className="board-overlay" data-testid="board-overlay">
          {props.overlay}
        </div>
      )}
    </div>
  );
}
