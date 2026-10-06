import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { worldToScreen, type Point } from './camera';
import { useBoardCamera } from './CameraProvider';
import {
  DRAG_THRESHOLD_PX,
  GRID_DOT_SIZE_SCREEN,
  GRID_SPACING_WORLD,
  WHEEL_LINE_MODE_PIXELS,
  WHEEL_PAGE_MODE_PIXELS,
  WHEEL_ZOOM_SENSITIVITY,
  TEXT_TOOL_DOUBLE_CLICK_GUARD_MS,
  TEXT_TOOL_DOUBLE_CLICK_GUARD_PX,
} from '../../shared/config';
import type { Tool } from '../board/useTool';

/** WheelEvent.deltaMode values (the static constants are not in every environment). */
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

/** Safari's pinch gesture event (not in the TypeScript DOM lib). */
interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly rotation?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

function mod(value: number, modulus: number): number {
  if (!(modulus > 0)) return 0;
  return ((value % modulus) + modulus) % modulus;
}

/** Converts a wheel delta into CSS pixels whatever unit the browser reported. */
function wheelDeltaPixels(e: WheelEvent): { deltaX: number; deltaY: number } {
  const perUnit =
    e.deltaMode === DELTA_MODE_LINE
      ? WHEEL_LINE_MODE_PIXELS
      : e.deltaMode === DELTA_MODE_PAGE
        ? WHEEL_PAGE_MODE_PIXELS
        : 1;
  return { deltaX: e.deltaX * perUnit, deltaY: e.deltaY * perUnit };
}

/** True when the keyboard shortcut should go to the page, not to the board. */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  );
}

export interface BoardViewportProps {
  /** Board objects (story 2: sticky notes), rendered in world coordinates. */
  children?: ReactNode;
  /** Empty board space was double-clicked: create an object at this screen point. */
  onCreateAt?(point: Point): void;
  /** Empty board space was clicked without panning: clear the selection. */
  onClearSelection?(): void;
  /**
   * Whether the board may be changed (story 4). False while the room could not load it: panning,
   * zooming and selecting go on working, and a double-click on empty space creates nothing.
   */
  canEdit?: boolean;
  /** Shift+drag started on empty space: begin marquee at this screen point. */
  onMarqueeBegin?(screen: Point): void;
  /** Marquee pointer moved. */
  onMarqueeMove?(screen: Point): void;
  /** Marquee pointer released: select objects inside rectangle. */
  onMarqueeEnd?(): void;
  /** Marquee was cancelled (pointercancel/escape): discard without selecting. */
  onMarqueeCancel?(): void;
  /**
   * Story 9: the tool the board is on. While it is `text`, a click anywhere on the board - on an
   * object or on empty space - neither pans, selects nor moves anything: it asks for a text object
   * at that point.
   */
  tool?: Tool;
  /** Story 9: the Text tool clicked the board: write here (screen coordinates). */
  onCreateText?(point: Point): void;
}

/**
 * The board's input surface: an unbounded area with a dot grid that moves with the
 * camera, a world layer (transformed with CSS) holding board objects, and an origin
 * marker that gives tests a stable pixel target.
 *
 * Gestures that start on a board object (anything inside `[data-board-object]`) are the
 * object's business: the viewport neither pans nor creates anything for those.
 */
export function BoardViewport({
  children,
  onCreateAt,
  onClearSelection,
  canEdit = true,
  onMarqueeBegin,
  onMarqueeMove,
  onMarqueeEnd,
  onMarqueeCancel,
  tool = 'select',
  onCreateText,
}: BoardViewportProps) {
  const {
    camera,
    registerViewport,
    beginPan,
    panMove,
    endPan,
    wheel,
    zoomStep,
    reset,
  } = useBoardCamera();
  const [node, setNodeState] = useState<HTMLDivElement | null>(null);
  const [panning, setPanning] = useState(false);
  const [marqueeing, setMarqueeing] = useState(false);
  // Guards the drag independently of render timing (Idle / Panning in the design).
  // `moved` remembers whether this gesture actually panned: a click without movement
  // on empty space clears the selection instead.
  const panningGuard = useRef({ active: false, moved: false, startX: 0, startY: 0 });
  const marqueeGuard = useRef({ active: false, moved: false, startX: 0, startY: 0 });
  // Where and when the Text tool last placed an object, to tell a deliberate double-click on empty
  // space from the second click of the gesture that placed a text.
  const placedText = useRef<{ x: number; y: number; at: number } | null>(null);

  const setNode = useCallback(
    (el: HTMLDivElement | null) => {
      setNodeState(el);
      registerViewport(el);
    },
    [registerViewport],
  );

  // ---- wheel (non-passive, so board gestures never zoom/scroll the page) ----
  useEffect(() => {
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { deltaX, deltaY } = wheelDeltaPixels(e);
      wheel({
        deltaX,
        deltaY,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX, y: e.clientY },
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [node, wheel]);

  // ---- Safari trackpad pinch (gesturestart / gesturechange) ----
  useEffect(() => {
    if (!node) return;
    let gestureScale = 1;
    const rectOf = (e: GestureEventLike) => {
      const rect = node.getBoundingClientRect();
      const x = e.clientX ?? rect.width / 2;
      const y = e.clientY ?? rect.height / 2;
      return { x, y };
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScale = (e as GestureEventLike).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const scale = gesture.scale ?? 1;
      const ratio = gestureScale > 0 ? scale / gestureScale : 1;
      gestureScale = scale;
      if (ratio === 1) return;
      // Express the pinch as the wheel delta that yields this zoom ratio.
      const deltaY = -Math.log(ratio) / WHEEL_ZOOM_SENSITIVITY;
      wheel({ deltaX: 0, deltaY, ctrlOrMeta: true, point: rectOf(gesture) });
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureScale = 1;
    };
    const options = { passive: false } as const;
    node.addEventListener('gesturestart', onGestureStart, options);
    node.addEventListener('gesturechange', onGestureChange, options);
    node.addEventListener('gestureend', onGestureEnd, options);
    return () => {
      node.removeEventListener('gesturestart', onGestureStart);
      node.removeEventListener('gesturechange', onGestureChange);
      node.removeEventListener('gestureend', onGestureEnd);
    };
  }, [node, wheel]);

  // ---- keyboard shortcuts (also stops the browser zooming the page) ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.defaultPrevented || isTextEntry(e.target)) return;
      switch (e.key) {
        case '=':
        case '+':
          e.preventDefault();
          zoomStep('in');
          break;
        case '-':
        case '_':
          e.preventDefault();
          zoomStep('out');
          break;
        case '0':
          e.preventDefault();
          reset();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomStep, reset]);

  // ---- the Text tool owns the board (story 9) ----
  //
  // Captured on the surface itself, so it runs before any object's own pointer handler: with the
  // Text tool up, a click on a sticky note is still a click *on the board*, and the note is not
  // selected, moved, nor edited. `stopPropagation` keeps the gesture away from the pan, marquee,
  // selection and object handlers alike.
  useEffect(() => {
    if (!node || tool !== 'text') return;
    const onPlacementDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return; // touch navigation is out of scope (story 1)
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      placedText.current = { x: event.clientX, y: event.clientY, at: Date.now() };
      onCreateText?.({ x: event.clientX, y: event.clientY });
    };
    node.addEventListener('pointerdown', onPlacementDown, true);
    return () => node.removeEventListener('pointerdown', onPlacementDown, true);
  }, [node, tool, onCreateText]);

  // ---- pointer drag ----
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; // touch navigation is out of scope (story 1)
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Story 11: while the Pen is up a drag sketches. The Pen's own surface covers this one and takes
    // the pointer first, so this guard is for a press that reaches the viewport anyway: it must not
    // pan, marquee or deselect behind the pen's back (`pen.navigation`).
    if (tool === 'pen') return;
    const target = e.target as HTMLElement | null;
    // Only empty board space starts a pan or marquee; board objects handle their own gestures.
    if (target?.closest('[data-board-object]')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);

    // Shift+drag on empty space: marquee selection
    if (e.shiftKey && onMarqueeBegin) {
      marqueeGuard.current = { active: true, moved: false, startX: e.clientX, startY: e.clientY };
      setMarqueeing(true);
      onMarqueeBegin({ x: e.clientX, y: e.clientY });
      return;
    }

    // Normal pan
    panningGuard.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
    };
    setPanning(true);
    beginPan({ x: e.clientX, y: e.clientY });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Marquee move
    const mg = marqueeGuard.current;
    if (mg.active) {
      if (!mg.moved) {
        const distance = Math.hypot(e.clientX - mg.startX, e.clientY - mg.startY);
        if (distance >= DRAG_THRESHOLD_PX) mg.moved = true;
      }
      onMarqueeMove?.({ x: e.clientX, y: e.clientY });
      return;
    }
    // Pan move
    const guard = panningGuard.current;
    if (!guard.active) return;
    if (!guard.moved) {
      const distance = Math.hypot(e.clientX - guard.startX, e.clientY - guard.startY);
      if (distance >= DRAG_THRESHOLD_PX) guard.moved = true;
    }
    panMove({ x: e.clientX, y: e.clientY });
  };

  const stopInteraction = (e: ReactPointerEvent<HTMLDivElement>, released: boolean) => {
    // Marquee end
    const mg = marqueeGuard.current;
    if (mg.active) {
      marqueeGuard.current = { active: false, moved: false, startX: 0, startY: 0 };
      setMarqueeing(false);
      if (released) {
        onMarqueeEnd?.();
      } else {
        onMarqueeCancel?.();
      }
      return;
    }
    // Pan end
    const guard = panningGuard.current;
    if (!guard.active) return;
    panningGuard.current = { active: false, moved: false, startX: 0, startY: 0 };
    setPanning(false);
    endPan(); // the board stays exactly where it was
    // a click on empty board space without panning deselects (a pan keeps the selection);
    // a cancelled gesture or a lost capture is not a click, so it changes nothing
    if (released && !guard.moved) onClearSelection?.();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    // a double-click on a note edits that note; only empty space creates one
    if (target?.closest('[data-board-object]')) return;
    // With the Text tool up there is no double-click action: those clicks placed text.
    if (tool === 'text') return;
    // With the Pen up there is none either: those clicks drew something.
    if (tool === 'pen') return;
    // …and the second click of the gesture that placed a text is not a request for a sticky note.
    const placed = placedText.current;
    if (
      placed &&
      Date.now() - placed.at <= TEXT_TOOL_DOUBLE_CLICK_GUARD_MS &&
      Math.hypot(e.clientX - placed.x, e.clientY - placed.y) <= TEXT_TOOL_DOUBLE_CLICK_GUARD_PX
    ) {
      return;
    }
    e.preventDefault();
    // read-only is read-only: the double-click is swallowed, not answered with a note the
    // person will lose when the board finally loads (story 4)
    if (!canEdit) return;
    onCreateAt?.({ x: e.clientX, y: e.clientY });
  };

  const origin = worldToScreen(camera, { x: 0, y: 0 });
  const gridSpacing = GRID_SPACING_WORLD * camera.zoom;
  const dot = `${GRID_DOT_SIZE_SCREEN}px`;

  return (
    <div
      ref={setNode}
      className="board-viewport"
      data-testid="board-viewport"
      data-board-surface
      data-interaction-state={marqueeing ? 'marquee' : panning ? 'panning' : 'idle'}
      data-tool={tool}
      data-camera-x={camera.x}
      data-camera-y={camera.y}
      data-camera-zoom={camera.zoom}
      style={{
        backgroundImage: `radial-gradient(circle, var(--grid-dot) ${dot}, transparent ${dot})`,
        backgroundSize: `${gridSpacing}px ${gridSpacing}px`,
        backgroundPosition: `${mod(-camera.x * camera.zoom, gridSpacing)}px ${mod(
          -camera.y * camera.zoom,
          gridSpacing,
        )}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        stopInteraction(e, true);
      }}
      onPointerCancel={(e) => {
        stopInteraction(e, false);
      }}
      onLostPointerCapture={(e) => {
        stopInteraction(e, false);
      }}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="board-world"
        data-testid="board-world"
        style={{ transform: `scale(${camera.zoom}) translate(${-camera.x}px, ${-camera.y}px)` }}
      >
        {children}
      </div>
      <div
        className="board-origin-marker"
        data-testid="origin-marker"
        aria-hidden="true"
        style={{ left: `${origin.x}px`, top: `${origin.y}px` }}
      />
    </div>
  );
}
