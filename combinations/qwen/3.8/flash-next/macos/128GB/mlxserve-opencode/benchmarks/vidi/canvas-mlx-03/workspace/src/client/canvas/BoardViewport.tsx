import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { screenToWorld, type Camera, type Point } from './camera.ts';
import type { CameraApi } from './useCamera.ts';
import type { MarqueeControls } from '../board/Marquee.tsx';
import { GRID_SPACING_WORLD, WHEEL_LINE_HEIGHT_PX, WHEEL_PAGE_HEIGHT_PX } from '../../shared/config.ts';

export interface BoardViewportProps {
  camera: Camera;
  viewportRef: RefObject<HTMLDivElement | null>;
  api: Pick<CameraApi, 'beginPan' | 'panMove' | 'endPan' | 'wheel' | 'gesture'>;
  children?: ReactNode;
  /** A press on empty board space (world point). Used to clear selection. */
  onBackgroundPointerDown?(world: Point): void;
  /** A double-click on empty board space (world point). Used to create a note. */
  onBackgroundDoubleClick?(world: Point): void;
  /**
   * Story 9: when the Text tool is active, a single press on empty board space
   * places a text there instead of starting a pan. `textPlacing` turns that on and
   * shows a crosshair; `onPlaceText` receives the world point.
   */
  textPlacing?: boolean;
  onPlaceText?(world: Point): void;
  /**
   * Box selection. When present, Shift+drag on empty space draws a marquee
   * instead of panning the board, and does not clear the current selection.
   */
  marquee?: MarqueeControls;
  /**
   * Story 10: the cursor the board surface shows while a drawing tool is armed
   * (a crosshair for the Shape and Connector tools). Defaults to the board's grab.
   */
  cursor?: string;
}

interface GestureEventLike extends Event {
  scale?: number;
}

function pointFrom(e: { clientX: number; clientY: number }, rect: DOMRect): Point {
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// Convert a wheel event's delta to CSS pixels, honouring deltaMode.
function wheelPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) return delta * WHEEL_LINE_HEIGHT_PX; // DOM_DELTA_LINE
  if (deltaMode === 2) return delta * WHEEL_PAGE_HEIGHT_PX; // DOM_DELTA_PAGE
  return delta; // DOM_DELTA_PIXEL
}

/**
 * The board input surface: dot-grid background, a world layer positioned with a
 * CSS transform, and the origin crosshair. Handles pointer drag, non-passive
 * wheel (board-owned), and Safari gesture events. All input calls go through the
 * camera.math API so the board never zooms the page.
 */
export function BoardViewport({ camera, viewportRef, api, children, onBackgroundPointerDown, onBackgroundDoubleClick, textPlacing, onPlaceText, marquee, cursor }: BoardViewportProps) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const bgDownRef = useRef(onBackgroundPointerDown);
  bgDownRef.current = onBackgroundPointerDown;
  const bgDblRef = useRef(onBackgroundDoubleClick);
  bgDblRef.current = onBackgroundDoubleClick;
  const textPlacingRef = useRef(textPlacing);
  textPlacingRef.current = textPlacing;
  const placeTextRef = useRef(onPlaceText);
  placeTextRef.current = onPlaceText;
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  // True while the pointer is drawing a selection box (not panning).
  const marqueeActiveRef = useRef(false);

  // The Text tool: while it is active, a pointerdown ANYWHERE over the board —
  // including on top of an existing object, whose own handler would otherwise
  // swallow it — places a text there and creates nothing else. A capture-phase
  // listener on the viewport sees it before any object does, and stops it there so
  // no pan, marquee, drag or edit starts.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || !textPlacing) return;
    const onCapture = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const p = pointFrom(e, rect);
      placeTextRef.current?.(screenToWorld(cameraRef.current, p));
    };
    el.addEventListener('pointerdown', onCapture, true);
    return () => el.removeEventListener('pointerdown', onCapture, true);
  }, [viewportRef, textPlacing]);

  // Non-passive wheel listener so we can always preventDefault over the board
  // (React's onWheel is passive and cannot stop page zoom / scroll).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Board owns the gesture: stop page zoom (ctrl/meta) and page scroll.
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      apiRef.current.wheel({
        deltaX: wheelPixels(e.deltaX, e.deltaMode),
        deltaY: wheelPixels(e.deltaY, e.deltaMode),
        ctrlOrMeta,
        point: pointFrom(e, rect),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewportRef]);

  // Safari (macOS/iOS) trackpad pinch fires gesture* events.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const startScaleRef = { current: 1 };
    const startCamRef = { current: null as null | Camera };
    void startCamRef;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      startScaleRef.current = (e as GestureEventLike).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ge = e as GestureEventLike & { clientX?: number; clientY?: number };
      const scale = ge.scale ?? 1;
      const point: Point =
        typeof ge.clientX === 'number' && typeof ge.clientY === 'number'
          ? { x: ge.clientX - rect.left, y: ge.clientY - rect.top }
          : { x: rect.width / 2, y: rect.height / 2 };
      apiRef.current.gesture(scale / startScaleRef.current, point);
      startScaleRef.current = scale;
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
    };
    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    el.addEventListener('gestureend', onGestureEnd as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
      el.removeEventListener('gestureend', onGestureEnd as EventListener);
    };
  }, [viewportRef]);

  const zoom = camera.zoom;
  const gridPx = GRID_SPACING_WORLD * zoom;
  const pos = worldToScreenPx(camera);
  const bgX = ((pos.x % gridPx) + gridPx) % gridPx;
  const bgY = ((pos.y % gridPx) + gridPx) % gridPx;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only start a pan when the press is on the board surface itself (viewport /
    // grid / origin marker), never on a board object (later stories stopPropagation).
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = pointFrom(e, rect);
    if (e.shiftKey && marqueeRef.current) {
      // Shift+drag on empty space selects with a box: it neither pans the board nor
      // clears the selection the way a plain press on empty space does.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      marqueeActiveRef.current = true;
      marqueeRef.current.begin(p);
      return;
    }
    // The Text tool is handled by the capture-phase listener above; the empty-space
    // press there must not also pan or clear, so bail when placing text.
    if (textPlacingRef.current) return;
    // Empty-space press: let the shell clear the current selection first.
    bgDownRef.current?.(screenToWorld(cameraRef.current, p));
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.style.cursor = 'grabbing';
    apiRef.current.beginPan(p);
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Create a note only when the double-click landed on empty board space; a
    // double-click on a note is stopped by that note (starts editing instead).
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    bgDblRef.current?.(screenToWorld(cameraRef.current, pointFrom(e, rect)));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = pointFrom(e, rect);
    if (marqueeActiveRef.current) {
      marqueeRef.current?.move(p);
      return;
    }
    apiRef.current.panMove(p);
  };
  // `cancelled` is a pointer that will never land (cancelled, capture stolen): the
  // marquee draws nothing and selects nothing.
  const finish = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (marqueeActiveRef.current) {
      marqueeActiveRef.current = false;
      if (cancelled) marqueeRef.current?.cancel();
      else marqueeRef.current?.end();
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    e.currentTarget.style.cursor = 'grab';
    apiRef.current.endPan();
  };

  return (
    <div
      ref={viewportRef}
      data-testid="viewport"
      className="vidi6-viewport"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        touchAction: 'none',
        overscrollBehavior: 'none',
        backgroundImage: 'radial-gradient(circle, #b8bcc4 1px, transparent 1.2px)',
        backgroundSize: `${gridPx}px ${gridPx}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        cursor: textPlacing ? 'text' : (cursor ?? 'grab'),
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e)}
      onPointerCancel={(e) => finish(e, true)}
      onLostPointerCapture={(e) => finish(e, true)}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 0,
          height: 0,
          transform: `scale(${zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        <div
          data-testid="origin-marker"
          aria-hidden
          style={{
            position: 'absolute',
            left: -10,
            top: -10,
            width: 20,
            height: 20,
          }}
        >
          <span
            style={{
              position: 'absolute',
              left: 0,
              top: 9,
              width: 20,
              height: 2,
              background: 'rgba(60,64,72,0.5)',
            }}
          />
          <span
            style={{
              position: 'absolute',
              left: 9,
              top: 0,
              width: 2,
              height: 20,
              background: 'rgba(60,64,72,0.5)',
            }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}

// Screen offset of the world origin (used to keep the grid welded to the board).
function worldToScreenPx(cam: Camera): Point {
  return { x: -cam.x * cam.zoom, y: -cam.y * cam.zoom };
}
