import { useEffect, useRef, useState } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import {
  GRID_SPACING_WORLD,
  WHEEL_LINE_PX,
  WHEEL_PAGE_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from '../../shared/config';
import type { CameraControls } from './useCamera';
import type { Marquee } from '../board/Marquee';

/** DOM WheelEvent deltaMode values (pixels = 0, lines = 1, pages = 2). */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;
/** Size of the origin crosshair marker, in world-unscaled px at zoom 1. */
const ORIGIN_MARKER_SIZE = 16;

export interface BoardViewportProps {
  children?: React.ReactNode;
  /** Shared camera state + input handlers from `useCamera` (see App.tsx). */
  controls: CameraControls;
  /** Called when the user double-clicks empty board space. */
  onDblClickEmpty?(point: { x: number; y: number }): void;
  /** Called when the user clicks empty board space (without dragging). */
  onClickEmpty?(): void;
  /**
   * The marquee (story 7, sel.marquee). Shift+pointerdown on empty space
   * drives begin/move/end; pointercancel and Escape drive cancel.
   */
  marquee?: Marquee;
  /**
   * Text tool active (story 9, text.tool): the cursor is a text caret and a
   * click anywhere (even on an existing object) calls `onTextToolClick` with
   * the local screen point. Object and pan gestures are suppressed.
   */
  textTool?: boolean;
  onTextToolClick?(point: { x: number; y: number }): void;
}

/** Positive modulo: result in [0, modulus). */
function mod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * The full-window board: input surface, dot grid and world layer.
 *
 * - Pan by dragging: pointerdown on empty board space captures the pointer;
 *   the board follows the pointer exactly until pointerup/pointercancel.
 * - Pan by scrolling: a non-passive wheel listener pans (and, with
 *   Ctrl/Cmd, zooms around the pointer), always preventDefault-ing so the
 *   browser page never scrolls or zooms.
 * - Safari pinch: gesturestart/gesturechange are prevented and folded into
 *   the same zoom path.
 * - Keyboard: Ctrl/Cmd + = / - / 0 step zoom and reset.
 */
export function BoardViewport({
  children,
  controls,
  onDblClickEmpty,
  onClickEmpty,
  marquee,
  textTool = false,
  onTextToolClick,
}: BoardViewportProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const panningRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset } = controls;

  // Marquee (story 7): a Shift-drag on empty space selects by containment.
  const marqueeRef = useRef(marquee);
  marqueeRef.current = marquee;
  // Suppress the click that follows a drag (pan or marquee).
  const suppressClickRef = useRef(false);
  // Text tool refs (stable window/capture listeners).
  const textToolRef = useRef(textTool);
  textToolRef.current = textTool;
  const onTextToolClickRef = useRef(onTextToolClick);
  onTextToolClickRef.current = onTextToolClick;

  const setPanningState = (value: boolean) => {
    panningRef.current = value;
    setPanning(value);
  };

  const localPoint = (clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };

  // Text tool: suppress pan and object gestures in the capture phase so a
  // click anywhere (even on an existing object) creates text on top.
  useEffect(() => {
    if (!textTool) return;
    const el = viewportRef.current;
    if (!el) return;
    const onPointerDownCapture = (e: PointerEvent) => {
      e.stopPropagation();
    };
    el.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => el.removeEventListener('pointerdown', onPointerDownCapture, true);
  }, [textTool]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (textToolRef.current) return; // the text tool creates text on click
    // Drag starts only on empty board space (the viewport/grid itself), so
    // later object stories can stop propagation on their own elements.
    if (e.target !== viewportRef.current) return;
    viewportRef.current?.setPointerCapture?.(e.pointerId);

    // Shift-drag on empty space → marquee (story 7), not a pan.
    if (e.shiftKey && marqueeRef.current) {
      marqueeRef.current.begin(localPoint(e.clientX, e.clientY));
      return;
    }

    setPanningState(true);
    beginPan(localPoint(e.clientX, e.clientY));
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== viewportRef.current) return;
    const point = localPoint(e.clientX, e.clientY);
    onDblClickEmpty?.(point);
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (textToolRef.current) {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // Text tool: a click anywhere (even on an object) creates text on top
      // at that point (text.tool).
      onTextToolClickRef.current?.(localPoint(e.clientX, e.clientY));
      return;
    }
    if (e.target !== viewportRef.current) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClickEmpty?.();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (panningRef.current) {
      panMove(localPoint(e.clientX, e.clientY));
      return;
    }
    if (marqueeRef.current?.rect) {
      marqueeRef.current.move(localPoint(e.clientX, e.clientY));
    }
  };

  const finishPan = (cancelled: boolean) => {
    if (panningRef.current) {
      setPanningState(false);
      endPan();
      suppressClickRef.current = true;
    }
    if (marqueeRef.current?.rect) {
      suppressClickRef.current = true;
      if (cancelled) marqueeRef.current.cancel();
      else marqueeRef.current.end();
    }
  };

  // Escape cancels an in-progress marquee (sel.marquee).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marqueeRef.current?.rect) {
        marqueeRef.current.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Wheel: must be non-passive so preventDefault can stop page scroll/zoom.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let { deltaX, deltaY } = e;
      if (e.deltaMode === DELTA_MODE_LINE) {
        deltaX *= WHEEL_LINE_PX;
        deltaY *= WHEEL_LINE_PX;
      } else if (e.deltaMode === DELTA_MODE_PAGE) {
        deltaX *= WHEEL_PAGE_PX;
        deltaY *= WHEEL_PAGE_PX;
      }
      const rect = el.getBoundingClientRect();
      wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel]);

  // Safari pinch: gesturestart/gesturechange (Playwright cannot synthesise
  // these; covered by the component test).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let lastScale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      lastScale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as Event & { scale?: number; clientX?: number; clientY?: number };
      const scale =
        typeof gesture.scale === 'number' && Number.isFinite(gesture.scale) && gesture.scale > 0
          ? gesture.scale
          : lastScale;
      const ratio = scale / lastScale;
      lastScale = scale;
      const rect = el.getBoundingClientRect();
      // Fold the scale ratio into the same zoom path as a Ctrl-wheel.
      wheel({
        deltaX: 0,
        deltaY: -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY,
        ctrlOrMeta: true,
        point: { x: (gesture.clientX ?? 0) - rect.left, y: (gesture.clientY ?? 0) - rect.top },
      });
    };
    el.addEventListener('gesturestart', onGestureStart, { passive: false });
    el.addEventListener('gesturechange', onGestureChange, { passive: false });
    return () => {
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [wheel]);

  // Keyboard shortcuts: Ctrl/Cmd + = / - / 0 (preventDefault stops page zoom).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomStep('in');
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoomStep('out');
      } else if (e.key === '0') {
        e.preventDefault();
        reset();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  const spacingPx = GRID_SPACING_WORLD * camera.zoom;
  const gridOffsetX = mod(-camera.x * camera.zoom, spacingPx);
  const gridOffsetY = mod(-camera.y * camera.zoom, spacingPx);


  return (
    <div
      ref={viewportRef}
      data-testid="board-viewport"
      data-mode={panning ? 'panning' : 'idle'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finishPan(false)}
      onPointerCancel={() => finishPan(true)}
      onLostPointerCapture={() => finishPan(true)}
      onDoubleClick={onDoubleClick}
      onClick={onClick}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        cursor: textTool ? 'text' : panning ? 'grabbing' : 'grab',
        backgroundColor: '#f7f7f4',
        backgroundImage: 'radial-gradient(circle, #c8c8c0 1px, transparent 1.6px)',
        backgroundSize: `${spacingPx}px ${spacingPx}px`,
        backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        touchAction: 'none',
      }}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          pointerEvents: 'none',
        }}
      >
        {/* Origin crosshair at world (0,0): a stable pixel target for e2e. */}
        <div
          data-testid="origin-marker"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -ORIGIN_MARKER_SIZE / 2,
            top: -ORIGIN_MARKER_SIZE / 2,
            width: ORIGIN_MARKER_SIZE,
            height: ORIGIN_MARKER_SIZE,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: ORIGIN_MARKER_SIZE / 2 - 1,
              width: ORIGIN_MARKER_SIZE,
              height: 2,
              background: '#e05a3a',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: ORIGIN_MARKER_SIZE / 2 - 1,
              top: 0,
              width: 2,
              height: ORIGIN_MARKER_SIZE,
              background: '#e05a3a',
            }}
          />
        </div>
        {children}
      </div>
    </div>
  );
}
