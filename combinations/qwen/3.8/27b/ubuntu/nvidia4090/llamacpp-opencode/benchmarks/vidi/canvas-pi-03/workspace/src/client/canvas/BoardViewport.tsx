import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCameraContext } from './CameraContext';
import { screenToWorld, type Point } from './camera';
import { GRID_SPACING_WORLD, WHEEL_ZOOM_SENSITIVITY } from '@/shared/config';
import type { ToolId } from '../tools/useActiveTool';

export interface BoardViewportProps {
  children?: React.ReactNode;
  /** Double-click on empty board space: create an object at this world point. */
  onCreateStickyAt?: (world: Point) => void;
  /** Story 9: click (press without movement) on empty board space with the Text tool active. */
  onCreateTextAt?: (world: Point) => void;
  /**
   * Story 9/10/11: the active tool — with Text active, clicks create text
   * and do not pan/marquee. With Pen active, left-button presses start a
   * stroke (routed to onPenDown) — they never pan, marquee, or move objects
   * (pen.draw). Shape/Connector tools render their own full-screen overlays
   * (story 10) and never reach the viewport; any other id is treated as
   * Select here.
   */
  tool?: ToolId;
  /**
   * Story 11: while the Pen tool is active, a left-button press on empty
   * board space is routed here (it starts a stroke; the Pen tool captures
   * the pointer). Wheel panning is unaffected.
   */
  onPenDown?: (e: React.PointerEvent) => void;
  /** Story 11: the pen cursor (thickness ring) while the Pen tool is active. */
  penCursor?: string;
  /** Click (press without movement) on empty board space: clear the selection. */
  onClearSelection?: () => void;
  /**
   * Story 7: shift+pointerdown on empty board space starts a marquee.
   * Screen points are viewport-local pixels (same space as the camera).
   */
  onMarqueeBegin?: (screen: Point) => void;
  onMarqueeMove?: (screen: Point) => void;
  onMarqueeEnd?: () => void;
  /** Pointer cancelled mid-marquee: discard with no selection change. */
  onMarqueeCancel?: () => void;
  /**
   * Story 12: file drag-and-drop onto the board (image.drop). Native
   * `DragEvent` handlers attached to the viewport root (the hook's handlers
   * are native, not React synthetic).
   */
  onDragEnter?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
}

export function BoardViewport(props: BoardViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { camera, beginPan, panMove, endPan, wheel, zoomStep, reset } = useCameraContext();

  // Story 12: attach native drag/drop listeners to the viewport root (the
  // image-insert hook's handlers are native DragEvents, not React synthetic).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { onDragEnter, onDragOver, onDragLeave, onDrop } = props;
    if (onDragEnter) el.addEventListener('dragenter', onDragEnter);
    if (onDragOver) el.addEventListener('dragover', onDragOver);
    if (onDragLeave) el.addEventListener('dragleave', onDragLeave);
    if (onDrop) el.addEventListener('drop', onDrop);
    return () => {
      if (onDragEnter) el.removeEventListener('dragenter', onDragEnter);
      if (onDragOver) el.removeEventListener('dragover', onDragOver);
      if (onDragLeave) el.removeEventListener('dragleave', onDragLeave);
      if (onDrop) el.removeEventListener('drop', onDrop);
    };
  }, [props.onDragEnter, props.onDragOver, props.onDragLeave, props.onDrop]);

  const isPanningRef = useRef(false);
  const isMarqueeingRef = useRef(false);
  const isTextPlacingRef = useRef(false);
  const downPosRef = useRef<Point | null>(null);
  // Story 9: a double-click right after a Text-tool click must not create a
  // sticky note (the first click already created text and switched tools).
  const lastTextCreateRef = useRef(0);
  const [cursorStyle, setCursorStyle] = useState('default');
  const tool = props.tool === 'text' ? 'text' : props.tool === 'pen' ? 'pen' : 'select';

  const localPoint = (e: React.PointerEvent): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Pointer events
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only start pan when clicking the viewport or world layer (not child objects with data-no-pan)
      const target = e.target as HTMLElement;
      if (target.dataset?.noPan) return;
      // Story 11: with the Pen tool active, a left-button press starts a
      // stroke — never a pan or marquee (pen.draw). The Pen tool (via
      // onPenDown) captures the pointer itself; wheel events still pan.
      if (tool === 'pen') {
        if (e.button === 0) props.onPenDown?.(e);
        return;
      }
      // Story 9: with the Text tool active, empty-space presses place text on
      // release; they never pan or marquee (text.tool).
      if (tool === 'text') {
        isTextPlacingRef.current = true;
        downPosRef.current = { x: e.clientX, y: e.clientY };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }
      // Story 7: shift+press on empty space is a marquee, not a pan.
      if (e.shiftKey) {
        isMarqueeingRef.current = true;
        downPosRef.current = null;
        setCursorStyle('crosshair');
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        props.onMarqueeBegin?.(localPoint(e));
        return;
      }
      isPanningRef.current = true;
      downPosRef.current = { x: e.clientX, y: e.clientY };
      setCursorStyle('grabbing');
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      beginPan({ x: e.clientX, y: e.clientY });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beginPan, props.onMarqueeBegin, tool, props.onPenDown],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isTextPlacingRef.current) return; // story 9: text placement has no move phase
      if (isMarqueeingRef.current) {
        props.onMarqueeMove?.(localPoint(e));
        return;
      }
      if (!isPanningRef.current) return;
      panMove({ x: e.clientX, y: e.clientY });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [panMove, props.onMarqueeMove],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (isTextPlacingRef.current) {
        isTextPlacingRef.current = false;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        const down = downPosRef.current;
        downPosRef.current = null;
        // A press without movement is a click: create text at the world point.
        if (down !== null && down.x === e.clientX && down.y === e.clientY) {
          lastTextCreateRef.current = Date.now();
          const create = props.onCreateTextAt;
          if (create !== undefined) create(screenToWorld(camera, localPoint(e)));
        }
        return;
      }
      if (isMarqueeingRef.current) {
        isMarqueeingRef.current = false;
        setCursorStyle('default');
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        props.onMarqueeEnd?.();
        return;
      }
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setCursorStyle('default');
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      const down = downPosRef.current;
      downPosRef.current = null;
      endPan();
      // A press on empty space without movement is a click: clear the selection.
      if (down !== null && down.x === e.clientX && down.y === e.clientY) {
        props.onClearSelection?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endPan, props.onClearSelection, props.onMarqueeEnd, camera, props.onCreateTextAt],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (isMarqueeingRef.current) {
        isMarqueeingRef.current = false;
        setCursorStyle('default');
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        props.onMarqueeCancel?.();
        return;
      }
      if (isTextPlacingRef.current) {
        isTextPlacingRef.current = false;
        downPosRef.current = null;
        try {
          (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        return;
      }
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      setCursorStyle('default');
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch { /* ignore */ }
      endPan();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [endPan, props.onMarqueeCancel],
  );

  // Non-passive wheel listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const LINE_HEIGHT = 16;
    const PAGE_HEIGHT = 100;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        dx *= LINE_HEIGHT;
        dy *= LINE_HEIGHT;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        dx *= PAGE_HEIGHT;
        dy *= PAGE_HEIGHT;
      }
      const rect = el.getBoundingClientRect();
      wheel({
        deltaX: dx,
        deltaY: dy,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [wheel]);

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
      const ge = e as unknown as { scale: number; clientX: number; clientY: number };
      const factor = ge.scale / lastScale;
      lastScale = ge.scale;
      if (factor !== 1 && Number.isFinite(factor) && factor > 0) {
        const rect = el.getBoundingClientRect();
        const point = { x: ge.clientX - rect.left, y: ge.clientY - rect.top };
        const deltaY = -Math.log(factor) / WHEEL_ZOOM_SENSITIVITY;
        wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point });
      }
    };

    el.addEventListener('gesturestart', onGestureStart as EventListener);
    el.addEventListener('gesturechange', onGestureChange as EventListener);
    return () => {
      el.removeEventListener('gesturestart', onGestureStart as EventListener);
      el.removeEventListener('gesturechange', onGestureChange as EventListener);
    };
  }, [wheel]);

  // Double-click on empty board space creates a sticky note centred on the
  // point (notes stop propagation of their own dblclick, so this only fires
  // for the viewport/grid background).
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== containerRef.current) return;
      const create = props.onCreateStickyAt;
      if (!create) return;
      // Story 9: ignore the double-click that follows a Text-tool click.
      if (Date.now() - lastTextCreateRef.current < 500) {
        lastTextCreateRef.current = 0;
        return;
      }
      // Story 11: the pen draws on every press; a double-click must not also
      // create a sticky note under it.
      if (tool === 'pen') return;
      const rect = containerRef.current.getBoundingClientRect();
      create(screenToWorld(camera, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
    },
    [camera, props.onCreateStickyAt, tool],
  );

  // Keyboard shortcuts
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

  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const gridPosX = -((camera.x * camera.zoom) % gridSpacing);
  const gridPosY = -((camera.y * camera.zoom) % gridSpacing);

  return (
    <div
      ref={containerRef}
      data-testid="board-viewport"
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        // Story 9: the pointer becomes a text cursor over the board while the
        // Text tool is active (text.tool).
        cursor:
          cursorStyle !== 'default'
            ? cursorStyle
            : tool === 'text'
              ? 'text'
              : tool === 'pen'
                ? (props.penCursor ?? 'crosshair')
                : 'default',
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${gridPosX}px ${gridPosY}px`,
        backgroundImage: 'radial-gradient(circle, #ccc 1px, transparent 1px)',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="world-layer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)`,
          transformOrigin: '0 0',
          width: 0,
          height: 0,
        }}
      >
        {/* Origin marker */}
        <div
          data-testid="origin-marker"
          style={{
            position: 'absolute',
            top: -4,
            left: -4,
            width: 8,
            height: 8,
            border: '1.5px solid #666',
            borderRadius: '50%',
            pointerEvents: 'none',
          }}
        />
        {props.children}
      </div>
    </div>
  );
}
