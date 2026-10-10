import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react';
import type * as Y from 'yjs';
import {
  DRAG_THRESHOLD_PX,
  PEN_COLORS,
  PEN_THICKNESS_WORLD,
  STROKE_MAX_POINTS,
  STROKE_SIMPLIFY_TOLERANCE_PX,
  type PenColor,
  type PenThickness
} from '../../shared/config';
import { simplify, smoothPath } from '../../shared/geometry/simplify';
import { createStroke } from '../../shared/objects/stroke';
import { screenToWorld, worldToScreen, type Point, type Camera } from '../canvas/camera';
import { useBoardCamera } from '../canvas/useCamera';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
  // Called after every createStroke commit so the board can close the undo
  // capture window: each finished stroke stays a single undo step even when
  // strokes are drawn back to back.
  onCommitted?(): void;
}

interface GestureEventLike extends Event {
  readonly scale?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

interface Capture {
  points: Point[];
  startScreen: Point;
  maxMove: number;
}

// Freehand drawing gesture: a full-board overlay captures every pointer
// event (so drags never pan the board or move objects), records coalesced
// points locally into a once-per-frame screen-space preview, and commits the
// stroke — simplified at a zoom-scaled tolerance — on release. A press
// without movement commits a single point (a round dot); pointercancel or
// lost capture commits the points so far; reaching STROKE_MAX_POINTS commits
// a part and continues from its last point so the two join without a gap.
export function PenTool(props: PenToolProps): JSX.Element {
  const { camera, color, thickness } = props;
  const latest = useRef(props);
  latest.current = props;
  const board = useBoardCamera();

  const overlayRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<Capture | null>(null);
  const rafRef = useRef<number | null>(null);
  const gestureScaleRef = useRef(1);
  const [preview, setPreview] = useState<string | null>(null);

  const commit = (points: Point[]): void => {
    const { doc, color, thickness, identityId, onCommitted } = latest.current;
    const zoom = latest.current.camera.zoom || 1;
    createStroke(
      doc,
      { points: simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom), color, thickness },
      identityId
    );
    onCommitted?.();
  };

  const schedulePreview = (): void => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const capture = captureRef.current;
      if (capture === null) return;
      const cam = latest.current.camera;
      setPreview(smoothPath(capture.points.map((p) => worldToScreen(cam, p))));
    });
  };

  const finish = (): void => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPreview(null);
    if (capture === null) return; // lostpointercapture after pointerup
    if (capture.maxMove < DRAG_THRESHOLD_PX || capture.points.length < 2) {
      commit([capture.points[0]]); // a click draws a round dot
    } else {
      commit(capture.points);
    }
  };

  const moveCursor = (x: number, y: number): void => {
    const el = cursorRef.current;
    if (el === null) return;
    const size = PEN_THICKNESS_WORLD[latest.current.thickness] * (latest.current.camera.zoom || 1);
    el.style.display = 'block';
    el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
  };

  // Scrolling still navigates while Pen is active (pen.navigation): the
  // overlay covers the viewport, so wheel and pinch are forwarded here with
  // the exact story 1 handling.
  useEffect(() => {
    const el = overlayRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      board.wheel({
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlOrMeta: e.ctrlKey || e.metaKey,
        point: { x: e.clientX, y: e.clientY }
      });
    };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureScaleRef.current = (e as GestureEventLike).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const gesture = e as GestureEventLike;
      const scale = gesture.scale ?? 1;
      const previous = gestureScaleRef.current || 1;
      gestureScaleRef.current = scale;
      board.zoomAtPointer(
        { x: gesture.clientX ?? 0, y: gesture.clientY ?? 0 },
        scale / previous
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [board]);

  // A tool switch (Escape or another tool) unmounts mid-capture: the
  // in-progress points are discarded and no preview is left behind.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    []
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and older engines lack pointer capture.
    }
    const cam = latest.current.camera;
    const start = { x: e.clientX, y: e.clientY };
    captureRef.current = { points: [screenToWorld(cam, start)], startScreen: start, maxMove: 0 };
    moveCursor(e.clientX, e.clientY);
    schedulePreview();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    moveCursor(e.clientX, e.clientY);
    const capture = captureRef.current;
    if (capture === null) return;
    e.stopPropagation();
    const native = e.nativeEvent;
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const events = coalesced.length > 0 ? coalesced : [native];
    const cam = latest.current.camera;
    for (const ev of events) {
      capture.points.push(screenToWorld(cam, { x: ev.clientX, y: ev.clientY }));
    }
    capture.maxMove = Math.max(
      capture.maxMove,
      Math.hypot(e.clientX - capture.startScreen.x, e.clientY - capture.startScreen.y)
    );
    if (capture.points.length >= STROKE_MAX_POINTS) {
      const last = capture.points[capture.points.length - 1];
      commit(capture.points);
      capture.points = [last]; // continue as a new stroke from the same point
    }
    schedulePreview();
  };

  const cursorSize = PEN_THICKNESS_WORLD[thickness] * (camera.zoom || 1);
  return (
    <div
      ref={overlayRef}
      data-testid="pen-tool-overlay"
      className="tool-overlay"
      style={{ cursor: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => {
        e.stopPropagation();
        finish();
      }}
      onPointerCancel={() => {
        finish();
      }}
      onLostPointerCapture={() => {
        finish();
      }}
      onPointerLeave={() => {
        const el = cursorRef.current;
        if (el !== null && captureRef.current === null) el.style.display = 'none';
      }}
    >
      {preview !== null && (
        <svg className="pen-preview" aria-hidden="true">
          <path
            data-testid="pen-preview"
            d={preview}
            fill="none"
            stroke={PEN_COLORS[color]}
            strokeWidth={cursorSize}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <div
        ref={cursorRef}
        data-testid="pen-cursor"
        className="pen-cursor"
        style={{
          display: 'none',
          width: cursorSize,
          height: cursorSize,
          background: PEN_COLORS[color]
        }}
        aria-hidden="true"
      />
    </div>
  );
}
