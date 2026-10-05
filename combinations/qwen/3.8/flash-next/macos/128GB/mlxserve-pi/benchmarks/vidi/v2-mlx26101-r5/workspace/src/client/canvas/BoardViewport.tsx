import { useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { screenToWorld } from './camera';
import type { Point } from './camera';
import type { CameraController } from './useCamera';

/** Wheel `deltaMode === LINE`: pixels per line. */
const WHEEL_DELTA_LINE_PX = 16;
/** Wheel `deltaMode === PAGE`: fraction of the board height per page. */
const WHEEL_DELTA_PAGE_FRACTION = 0.9;
/** Safari's non-standard pinch events. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly prevScale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

/** Dot grid: one dot on every world grid intersection. */
const GRID_IMAGE = 'radial-gradient(circle at 0 0, var(--grid-dot) 1px, transparent 1.5px)';

const mod = (value: number, period: number): number => ((value % period) + period) % period;

/** CSS pixels without exponential notation, rounded to sub-pixel precision. */
const px = (value: number): string => `${Number(value.toFixed(6))}px`;

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export interface BoardViewportProps {
  children?: ReactNode;
  /** Camera state and handlers, from `useCamera` in App. */
  controller: CameraController;
  /**
   * A double-click on empty board space, with the point converted to world
   * coordinates. Objects stop propagation, so a double-click on one never
   * reaches this handler.
   */
  onCreateSticky?(world: Point): void;
  /** A press on empty board space that did not move: clear the selection. */
  onClearSelection?(): void;
}

/**
 * The board's input surface: dot grid, world layer and the pointer / wheel /
 * gesture / keyboard handlers that navigate the camera.
 *
 * Wheel and gesture listeners are attached with `{ passive: false }` and always
 * `preventDefault()`, which is what stops the browser from zooming or scrolling
 * the page while the board is being navigated. Keydown shortcuts are attached to
 * `window`. Drag only starts on the board surface itself (the viewport or the
 * grid), so objects added by later stories can stop propagation.
 */
export function BoardViewport({
  children,
  controller,
  onCreateSticky,
  onClearSelection,
}: BoardViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef(controller);
  const gestureScaleRef = useRef(1);
  /** A press on the board surface that has not moved further than the threshold. */
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  controllerRef.current = controller;

  const { camera, isPanning } = controller;

  /** Screen point relative to the top-left of the board area. */
  const localPoint = (clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    const rect = el?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // wheel (non-passive), Safari gesture events and the keyboard shortcuts.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const toPixels = (delta: number, deltaMode: number): number => {
      if (!Number.isFinite(delta) || delta === 0) return 0;
      if (deltaMode === 1) return delta * WHEEL_DELTA_LINE_PX;
      if (deltaMode === 2) return delta * el.clientHeight * WHEEL_DELTA_PAGE_FRACTION;
      return delta;
    };

    const onWheel = (event: WheelEvent) => {
      // Always preventDefault over the board: the board owns the gesture, so the
      // page never scrolls and never zooms.
      event.preventDefault();
      const c = controllerRef.current;
      c.wheel({
        deltaX: toPixels(event.deltaX, event.deltaMode),
        deltaY: toPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point: localPoint(event.clientX, event.clientY),
      });
    };

    const onGesture = (event: Event) => {
      event.preventDefault();
      const gesture = event as GestureEventLike;
      const scale = positive(gesture.scale ?? 1, 1);
      if (event.type === 'gesturestart' || event.type === 'gestureend') {
        gestureScaleRef.current = scale;
        return;
      }
      const previous = positive(gesture.prevScale ?? gestureScaleRef.current, 1);
      const ratio = scale / previous;
      gestureScaleRef.current = scale;
      const clientX = gesture.clientX ?? el.clientWidth / 2;
      const clientY = gesture.clientY ?? el.clientHeight / 2;
      if (ratio !== 1) controllerRef.current.zoomBy(ratio, localPoint(clientX, clientY));
    };

    const isEditable = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT');

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target)) return;
      const c = controllerRef.current;
      if (event.key === '0' && (event.ctrlKey || event.metaKey)) {
        // Ctrl/Cmd + 0: reset view (prevented so the browser zoom stays put).
        event.preventDefault();
        c.reset();
        return;
      }
      if (event.altKey || event.shiftKey) return;
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key === '=' || event.key === '+' || event.key === 'Add') {
        event.preventDefault();
        c.zoomStep('in');
      } else if (event.key === '-' || event.key === '_' || event.key === 'Subtract') {
        event.preventDefault();
        c.zoomStep('out');
      }
    };

    const endDrag = () => controllerRef.current.endPan();

    el.addEventListener('wheel', onWheel, { passive: false });
    // A drag interrupted by the system ends here too (pointerup/pointercancel
    // are handled as React props on the board surface).
    el.addEventListener('lostpointercapture', endDrag);
    for (const name of GESTURE_EVENTS) {
      el.addEventListener(name, onGesture, { passive: false });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('lostpointercapture', endDrag);
      for (const name of GESTURE_EVENTS) {
        el.removeEventListener(name, onGesture);
      }
      window.removeEventListener('keydown', onKeyDown);
    };
    // Handlers read the controller through a ref, so they are attached once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isBoardSurface = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && target.dataset['boardSurface'] !== undefined;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey) return;
    if (!isBoardSurface(event.target)) return;
    const point = localPoint(event.clientX, event.clientY);
    pressRef.current = { x: point.x, y: point.y, moved: false };
    const el = viewportRef.current;
    try {
      el?.setPointerCapture?.(event.pointerId);
    } catch {
      // jsdom and some embedded browsers do not implement pointer capture.
    }
    controllerRef.current.beginPan(point);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The hook ignores moves while it is Idle, so nothing to gate here.
    const point = localPoint(event.clientX, event.clientY);
    const press = pressRef.current;
    if (press && !press.moved) {
      const distance = Math.hypot(point.x - press.x, point.y - press.y);
      if (distance >= DRAG_THRESHOLD_PX) press.moved = true;
    }
    controllerRef.current.panMove(point);
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    try {
      if (el?.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
    } catch {
      // ignore: capture may already be gone
    }
    const press = pressRef.current;
    pressRef.current = null;
    controllerRef.current.endPan();
    // A press on empty board space without a drag is a click on the board.
    if (press && !press.moved && event.type === 'pointerup') onClearSelection?.();
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Only empty board space: a note stops propagation and edits itself.
    if (!isBoardSurface(event.target)) return;
    const camera = controllerRef.current.camera;
    onCreateSticky?.(screenToWorld(camera, localPoint(event.clientX, event.clientY)));
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const offsetX = mod(-camera.x * camera.zoom, spacing);
  const offsetY = mod(-camera.y * camera.zoom, spacing);
  const worldTransform = `scale(${camera.zoom}) translate(${px(-camera.x)}, ${px(-camera.y)})`;

  return (
    <div
      aria-label="Board"
      className="board-viewport"
      data-board-surface="viewport"
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      data-panning={isPanning ? 'true' : 'false'}
      data-testid="board-viewport"
      ref={viewportRef}
      role="application"
      style={{
        backgroundImage: GRID_IMAGE,
        backgroundSize: `${px(spacing)} ${px(spacing)}`,
        backgroundPosition: `${px(offsetX)} ${px(offsetY)}`,
      }}
      onLostPointerCapture={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onDoubleClick={onDoubleClick}
    >
      <div aria-hidden="true" className="board-grid" data-board-surface="grid" data-testid="board-grid" />
      <div
        className="board-world"
        data-testid="world-layer"
        data-transform={worldTransform}
        style={{ transform: worldTransform, '--inv-zoom': String(1 / camera.zoom) } as React.CSSProperties}
      >
        <div aria-hidden="true" className="origin-marker" data-testid="origin-marker" />
        {children}
      </div>
    </div>
  );
}
