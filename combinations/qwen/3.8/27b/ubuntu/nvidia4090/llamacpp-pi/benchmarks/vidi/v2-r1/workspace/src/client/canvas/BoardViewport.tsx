// BoardViewport: the input surface of the infinite board.
// Story 1: drag to pan, wheel/trackpad scroll and pinch to zoom, Safari
// gestures, Ctrl/Cmd keyboard shortcuts, dot grid, world layer.
// Story 2: double-click on empty space creates a sticky note; a click on
// empty space (without dragging) clears the selection; board objects render
// as children in world coordinates.

import { useEffect, useRef, type JSX } from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_DELTA_LINE_PX,
  WHEEL_DELTA_PAGE_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import { type Camera, type Point, type Size } from './camera';
import { type WheelInput } from './useCamera';

export interface BoardViewportProps {
  camera: Camera;
  size: Size;
  onBeginPan(p: Point): void;
  onPanMove(p: Point): void;
  onEndPan(): void;
  onWheel(input: WheelInput): void;
  onZoomStep(dir: 'in' | 'out'): void;
  onReset(): void;
  /** Double-click on empty board space, at the screen point. */
  onCreateStickyAt(screen: Point): void;
  /** A click (press + release without meaningful movement) on empty space. */
  onEmptyClick(): void;
  children?: React.ReactNode;
}

/** Movement (screen px) below which a press on empty space counts as a click. */
const CLICK_SLOP_PX = 2;

export function BoardViewport(props: BoardViewportProps): JSX.Element {
  const {
    camera,
    size,
    onBeginPan,
    onPanMove,
    onEndPan,
    onWheel,
    onZoomStep,
    onReset,
    onCreateStickyAt,
    onEmptyClick,
    children,
  } = props;

  const viewportRef = useRef<HTMLDivElement>(null);
  const panIdRef = useRef<number | null>(null);
  const panStartRef = useRef<Point | null>(null);
  const lastScaleRef = useRef(1);

  // Keep the latest callbacks in a ref so native listeners attach once.
  const cbRef = useRef({ onBeginPan, onPanMove, onEndPan, onWheel, onZoomStep, onReset, onCreateStickyAt, onEmptyClick });
  cbRef.current = { onBeginPan, onPanMove, onEndPan, onWheel, onZoomStep, onReset, onCreateStickyAt, onEmptyClick };

  const toLocal = (clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  // Non-passive wheel listener: React's onWheel is passive, but we must be
  // able to preventDefault so the page never scrolls or zooms (zoom.no_page_zoom).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const scale =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? WHEEL_DELTA_LINE_PX
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? WHEEL_DELTA_PAGE_PX
            : 1;
      cbRef.current.onWheel({
        deltaX: e.deltaX * scale,
        deltaY: e.deltaY * scale,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: toLocal(e.clientX, e.clientY),
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  // Safari pinch: gesturestart/gesturechange with preventDefault.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScaleRef.current = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as unknown as { scale?: number; clientX?: number; clientY?: number };
      const scale = ge.scale ?? 1;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const ratio = scale / lastScaleRef.current;
      lastScaleRef.current = scale;
      // Express the gesture as the wheel input that yields factor = ratio.
      cbRef.current.onWheel({
        deltaX: 0,
        deltaY: -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: toLocal(ge.clientX ?? 0, ge.clientY ?? 0),
      });
    };
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

  // Ctrl/Cmd + = / - / 0 keyboard shortcuts (zoom.no_page_zoom: preventDefault).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        cbRef.current.onZoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        cbRef.current.onZoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        cbRef.current.onReset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Drag to pan only starts on empty board space; objects stop propagation.
    if (e.target !== viewportRef.current) return;
    e.preventDefault();
    const el = viewportRef.current;
    if (el && typeof el.setPointerCapture === 'function') {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore: capture is best-effort (jsdom, older browsers).
      }
    }
    panIdRef.current = e.pointerId;
    panStartRef.current = toLocal(e.clientX, e.clientY);
    cbRef.current.onBeginPan(panStartRef.current);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panIdRef.current !== e.pointerId) return;
    cbRef.current.onPanMove(toLocal(e.clientX, e.clientY));
  };

  const finishPan = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panIdRef.current !== e.pointerId) return;
    panIdRef.current = null;
    const start = panStartRef.current;
    panStartRef.current = null;
    const el = viewportRef.current;
    if (el && typeof el.releasePointerCapture === 'function') {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore.
      }
    }
    cbRef.current.onEndPan();
    if (start) {
      const rect = el ? el.getBoundingClientRect() : undefined;
      const moved = Math.hypot(
        e.clientX - (start.x + (rect ? rect.left : 0)),
        e.clientY - (start.y + (rect ? rect.top : 0)),
      );
      if (moved < CLICK_SLOP_PX) cbRef.current.onEmptyClick();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only a double-click on empty board space creates a note; a double-click
    // on a note is handled by the note itself (which stops propagation).
    if (e.target !== viewportRef.current) return;
    cbRef.current.onCreateStickyAt(toLocal(e.clientX, e.clientY));
  };

  const spacing = GRID_SPACING_WORLD * camera.zoom;
  const gridX = -((camera.x * camera.zoom) % spacing);
  const gridY = -((camera.y * camera.zoom) % spacing);

  return (
    <div
      ref={viewportRef}
      className="board-viewport"
      data-testid="board-viewport"
      style={{
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${gridX}px ${gridY}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishPan}
      onPointerCancel={finishPan}
      onLostPointerCapture={finishPan}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="board-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        <div className="board-origin-marker" data-testid="origin-marker" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
