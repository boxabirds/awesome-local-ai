import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { DRAG_THRESHOLD_PX, GRID_SPACING_WORLD } from '../../shared/config';
import { NavigationHint } from './NavigationHint';
import { ZoomControls } from './ZoomControls';
import { useCamera, wheelDeltaToPixels, type CameraController } from './useCamera';
import { screenToWorld, viewportCentre, type Camera, type Point, type Size } from './camera';
import type { Tool } from '../board/useTool';

/** Safari's pinch gesture events; not in the standard DOM typings. */
interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly rotation: number;
  readonly clientX: number;
  readonly clientY: number;
}

/** Positive modulo, so a background position is always within one tile. */
function mod(value: number, modulo: number): number {
  if (!(modulo > 0) || !Number.isFinite(value)) return 0;
  return ((value % modulo) + modulo) % modulo;
}

/** True when the key event should go to the focused field instead of the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Geometry the viewport owns but the toolbar needs: the world point at the
 * centre of the visible board area.
 */
export interface ViewportBridge {
  centreWorld(): Point | null;
}

export interface BoardViewportProps {
  children?: ReactNode;
  /**
   * Called for a double-click on empty board space, with the world point under
   * the cursor. Board objects stop propagation, so a double-click on a note
   * never reaches this.
   */
  onCreateStickyWorld?(at: Point): void;
  /** Called when a press on empty board space ends without dragging. */
  onClearSelection?(): void;
  /** Filled in so parents can ask the viewport for geometry. */
  bridgeRef?: MutableRefObject<ViewportBridge | null>;
  /** Called whenever the camera changes, so object layers can scale with it. */
  onCameraChange?(camera: Camera): void;
  /** Called when shift+drag starts on empty space (marquee). */
  onMarqueeStart?(screen: Point): void;
  /** Called when shift+drag moves. */
  onMarqueeMove?(screen: Point): void;
  /** Called when shift+drag ends. */
  onMarqueeEnd?(): void;
  /** Called when shift+drag is cancelled. */
  onMarqueeCancel?(): void;
  /** Overlay content rendered after the world layer (for marquee, selection overlay, etc.) */
  overlay?: ReactNode;
  /** Active tool: 'text' changes cursor and click behavior. */
  tool?: Tool;
  /** Called when the board is clicked while Text tool is active. */
  onTextToolClick?(worldPoint: Point): void;
}

/**
 * The board's input surface: an unbounded dot grid plus a world layer that both
 * follow the camera.
 *
 * - Drag on empty board space pans (pointer capture; ends on pointerup,
 *   pointercancel or lost capture).
 * - Shift+drag on empty board space starts a marquee selection.
 * - A non-passive wheel handler always calls `preventDefault`, so scrolling
 *   pans and Ctrl/Cmd-scroll (or a trackpad pinch) zooms the *board*, never the
 *   web page.
 * - Safari `gesturestart`/`gesturechange` are prevented and zoom around the pointer.
 * - Ctrl/Cmd + `=`, `-` and `0` zoom one step or reset the view.
 * - A double-click on empty space asks for a sticky note there; a click on
 *   empty space without dragging clears the selection.
 * - When tool === 'text', cursor is 'text' and click creates text at the point.
 */
export function BoardViewport({
  children,
  onCreateStickyWorld,
  onClearSelection,
  bridgeRef,
  onCameraChange,
  onMarqueeStart,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  overlay,
  tool,
  onTextToolClick,
}: BoardViewportProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [panning, setPanning] = useState(false);
  const controller: CameraController = useCamera(viewport);
  const controllerRef = useRef<CameraController>(controller);
  controllerRef.current = controller;
  const panningRef = useRef(false);
  const marqueeRef = useRef(false);
  /** Pointer position at the last press on empty board space. */
  const pressStartRef = useRef<Point | null>(null);
  /** Farthest pointer travel since pointerdown, to tell a click from a drag. */
  const travelRef = useRef(0);
  const cameraRef = useRef(controller.camera);
  cameraRef.current = controller.camera;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const onTextToolClickRef = useRef(onTextToolClick);
  onTextToolClickRef.current = onTextToolClick;

  // Viewport size. The camera is defined against the top-left of the board
  // area, so a resize never moves content.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const rect = entry ? entry.contentRect : el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setViewport((prev) =>
        prev.width === rect.width && prev.height === rect.height
          ? prev
          : { width: rect.width, height: rect.height },
      );
    }
    return () => observer.disconnect();
  }, []);

  const pointOf = useCallback((clientX: number, clientY: number): Point => {
    const el = viewportRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  // Wheel: React's onWheel is registered passive, so listen directly.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // Always claimed by the board: the page must never scroll or zoom here.
      event.preventDefault();
      const point = pointOf(event.clientX, event.clientY);
      controllerRef.current.wheel({
        deltaX: wheelDeltaToPixels(event.deltaX, event.deltaMode),
        deltaY: wheelDeltaToPixels(event.deltaY, event.deltaMode),
        ctrlOrMeta: event.ctrlKey || event.metaKey,
        point,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [pointOf]);

  // Safari pinch gestures.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let lastScale = 1;
    const onStart = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const onChange = (event: Event) => {
      event.preventDefault();
      const gesture = event as SafariGestureEvent;
      if (!Number.isFinite(gesture.scale) || gesture.scale <= 0) return;
      const ratio = gesture.scale / (lastScale || 1);
      lastScale = gesture.scale;
      if (ratio === 1) return;
      controllerRef.current.pinchAt(pointOf(gesture.clientX, gesture.clientY), ratio);
    };
    const onEnd = (event: Event) => {
      event.preventDefault();
      lastScale = 1;
    };
    const handlers: ReadonlyArray<readonly [string, (event: Event) => void]> = [
      ['gesturestart', onStart],
      ['gesturechange', onChange],
      ['gestureend', onEnd],
    ];
    for (const [type, handler] of handlers) {
      el.addEventListener(type, handler, { passive: false });
    }
    return () => {
      for (const [type, handler] of handlers) {
        el.removeEventListener(type, handler);
      }
    };
  }, [pointOf]);

  // Keyboard zoom shortcuts: Ctrl/Cmd + = , - and 0. Preventing the default
  // stops the browser's own page zoom.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isTextEntry(event.target)) return;
      switch (event.key) {
        case '=':
        case '+':
          event.preventDefault();
          controllerRef.current.zoomStep('in');
          break;
        case '-':
        case '_':
          event.preventDefault();
          controllerRef.current.zoomStep('out');
          break;
        case '0':
          event.preventDefault();
          controllerRef.current.reset();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const stopPanning = useCallback(() => {
    if (!panningRef.current) return;
    panningRef.current = false;
    setPanning(false);
    controllerRef.current.endPan();
  }, []);

  const stopMarquee = useCallback(() => {
    if (!marqueeRef.current) return;
    marqueeRef.current = false;
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const el = viewportRef.current;
      if (!el) return;
      // Only empty board space starts a drag; objects stop propagation.
      if (event.target !== el) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      // When Text tool is active, do not pan or marquee; just record press
      if (toolRef.current === 'text') {
        travelRef.current = 0;
        pressStartRef.current = pointOf(event.clientX, event.clientY);
        el.setPointerCapture?.(event.pointerId);
        return;
      }

      el.setPointerCapture?.(event.pointerId);
      travelRef.current = 0;
      pressStartRef.current = pointOf(event.clientX, event.clientY);

      // Shift+drag on empty space → marquee
      if (event.shiftKey && onMarqueeStart) {
        marqueeRef.current = true;
        onMarqueeStart(pointOf(event.clientX, event.clientY));
        return;
      }

      // Plain drag → pan
      panningRef.current = true;
      setPanning(true);
      controllerRef.current.beginPan(pointOf(event.clientX, event.clientY));
    },
    [pointOf, onMarqueeStart],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const point = pointOf(event.clientX, event.clientY);

      if (toolRef.current === 'text') {
        const start = pressStartRef.current;
        if (start) {
          travelRef.current = Math.max(
            travelRef.current,
            Math.hypot(point.x - start.x, point.y - start.y),
          );
        }
        return;
      }

      if (marqueeRef.current) {
        const start = pressStartRef.current;
        if (start) {
          travelRef.current = Math.max(
            travelRef.current,
            Math.hypot(point.x - start.x, point.y - start.y),
          );
        }
        onMarqueeMove?.(point);
        return;
      }

      if (!panningRef.current) return;
      const start = pressStartRef.current;
      if (start) {
        travelRef.current = Math.max(
          travelRef.current,
          Math.hypot(point.x - start.x, point.y - start.y),
        );
      }
      controllerRef.current.panMove(point);
    },
    [pointOf, onMarqueeMove],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const el = viewportRef.current;
      const wasEmptyPress = !marqueeRef.current && !panningRef.current && pressStartRef.current !== null && travelRef.current < DRAG_THRESHOLD_PX;
      const wasPanningPress = !marqueeRef.current && panningRef.current && travelRef.current < DRAG_THRESHOLD_PX;

      if (el?.hasPointerCapture?.(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }

      if (marqueeRef.current) {
        stopMarquee();
        onMarqueeEnd?.();
        return;
      }

      // Text tool: click creates text at the world point
      if (toolRef.current === 'text') {
        if (wasEmptyPress && event.target === el) {
          const point = pointOf(event.clientX, event.clientY);
          const world = screenToWorld(cameraRef.current, point);
          onTextToolClickRef.current?.(world);
        }
        pressStartRef.current = null;
        travelRef.current = 0;
        return;
      }

      stopPanning();
      // A press on empty board space that never became a drag deselects.
      if ((wasEmptyPress || wasPanningPress) && event.target === el) onClearSelection?.();
    },
    [pointOf, stopPanning, stopMarquee, onClearSelection, onMarqueeEnd],
  );

  const onPointerCancel = useCallback(() => {
    if (marqueeRef.current) {
      stopMarquee();
      onMarqueeCancel?.();
      return;
    }
    if (toolRef.current === 'text') {
      pressStartRef.current = null;
      travelRef.current = 0;
      return;
    }
    stopPanning();
  }, [stopPanning, stopMarquee, onMarqueeCancel]);

  /** A double-click on empty board space asks for a note at that world point. */
  const onDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const el = viewportRef.current;
      if (!el || event.target !== el) return;
      if (toolRef.current === 'text') return; // Text tool handles clicks, not double-clicks
      if (!onCreateStickyWorld) return;
      const point = pointOf(event.clientX, event.clientY);
      onCreateStickyWorld(screenToWorld(cameraRef.current, point));
    },
    [onCreateStickyWorld, pointOf],
  );

  // Publish viewport geometry so the toolbar can create a note at the centre.
  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.current = {
      centreWorld: (): Point | null => {
        if (viewport.width <= 0 || viewport.height <= 0) return null;
        return screenToWorld(cameraRef.current, viewportCentre(viewport));
      },
    };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef, viewport.width, viewport.height]);

  // Report camera changes upward: notes need the zoom to keep a drag under
  // the pointer and to counter-scale their toolbar.
  useEffect(() => {
    onCameraChange?.(controller.camera);
  }, [controller.camera, onCameraChange]);

  const { camera } = controller;
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridStyle = {
    backgroundImage: 'radial-gradient(circle at 1px 1px, var(--grid-dot) 1.5px, transparent 1.5px)',
    backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
    backgroundPosition: `${mod(-camera.x * camera.zoom, gridSpacing)}px ${mod(
      -camera.y * camera.zoom,
      gridSpacing,
    )}px`,
    cursor: tool === 'text' ? 'text' as const : undefined,
  };
  const worldStyle = {
    transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
  };

  return (
    <>
      <div
        ref={viewportRef}
        className="board-viewport"
        data-testid="board-viewport"
        aria-label="Board"
        data-panning={panning ? 'true' : 'false'}
        data-camera-x={camera.x}
        data-camera-y={camera.y}
        data-zoom={camera.zoom}
        data-tool={tool ?? 'select'}
        style={gridStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="board-world"
          data-testid="world-layer"
          style={worldStyle}
        >
          <div
            className="origin-marker"
            data-testid="origin-marker"
            aria-hidden="true"
            style={{ transform: `translate(-50%, -50%) scale(${1 / camera.zoom})` }}
          />
          {children}
        </div>
        {overlay}
      </div>
      <ZoomControls
        zoomPercent={controller.zoomPercent}
        canZoomIn={controller.canZoomIn}
        canZoomOut={controller.canZoomOut}
        onZoomIn={() => controllerRef.current.zoomStep('in')}
        onZoomOut={() => controllerRef.current.zoomStep('out')}
        onReset={() => controllerRef.current.reset()}
      />
      <NavigationHint visible={!controller.hasNavigated} />
    </>
  );
}
