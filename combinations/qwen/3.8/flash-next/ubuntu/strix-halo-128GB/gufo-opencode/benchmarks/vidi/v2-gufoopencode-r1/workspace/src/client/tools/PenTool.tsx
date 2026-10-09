import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, JSX } from 'react';
import * as Y from 'yjs';
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
import type { Point } from '../../shared/geometry';
import { screenToWorld, worldToScreen, type Camera } from '../canvas/camera';
import { useUndoController } from '../board/useUndo';

export interface PenToolProps {
  camera: Camera;
  color: PenColor;
  thickness: PenThickness;
  doc: Y.Doc;
  identityId: string;
}

interface Capture {
  pointerId: number;
  points: Point[];
  startClient: Point;
  moved: boolean;
}

// Story 11 Pen tool (design pen.tool): a screen-space overlay that captures
// the pointer and its coalesced events into a growing world-space path. The
// path is drawn locally every animation frame and never synced; on release
// (or interruption, or the hard point cap) it is simplified and committed as
// one stroke object. A below-threshold press commits a single-point dot.
export function PenTool(props: PenToolProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const capture = useRef<Capture | null>(null);
  const frame = useRef<number | null>(null);
  const hover = useRef<Point | null>(null);
  const [, setTick] = useState(0);

  // Latest props for handlers created during any render.
  const cameraRef = useRef(props.camera);
  cameraRef.current = props.camera;
  const colorRef = useRef(props.color);
  colorRef.current = props.color;
  const thicknessRef = useRef(props.thickness);
  thicknessRef.current = props.thickness;
  const docRef = useRef(props.doc);
  docRef.current = props.doc;
  const identityRef = useRef(props.identityId);
  identityRef.current = props.identityId;
  const undo = useUndoController();
  const undoRef = useRef(undo);
  undoRef.current = undo;

  const toWorld = (clientX: number, clientY: number): Point => {
    const element = rootRef.current;
    if (element === null) return screenToWorld(cameraRef.current, { x: clientX, y: clientY });
    const rect = element.getBoundingClientRect();
    return screenToWorld(cameraRef.current, { x: clientX - rect.left, y: clientY - rect.top });
  };

  // One part = one stroke object, one undo step. The simplify tolerance is a
  // screen-pixel setting, so it converts to world units by the current zoom.
  const commit = (points: readonly Point[]): void => {
    if (points.length === 0) return;
    const zoom = cameraRef.current.zoom > 0 ? cameraRef.current.zoom : 1;
    const reduced = simplify(points, STROKE_SIMPLIFY_TOLERANCE_PX / zoom);
    if (reduced.length === 0) return;
    undoRef.current?.boundary();
    createStroke(docRef.current, { points: reduced, color: colorRef.current, thickness: thicknessRef.current }, identityRef.current);
    undoRef.current?.boundary();
  };

  // Preview repaints at most once per animation frame no matter how many
  // pointer events arrive in between (design pen.preview_frame).
  const schedule = (): void => {
    if (frame.current === null) {
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setTick((t) => t + 1);
      });
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.stopPropagation();
    hover.current = { x: event.clientX, y: event.clientY };
    capture.current = {
      pointerId: event.pointerId,
      points: [toWorld(event.clientX, event.clientY)],
      startClient: { x: event.clientX, y: event.clientY },
      moved: false
    };
    try {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // jsdom and older browsers: window-level pointer events still drive the drag.
    }
    setTick((t) => t + 1);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    hover.current = { x: event.clientX, y: event.clientY };
    const active = capture.current;
    if (active === null || event.pointerId !== active.pointerId) {
      schedule();
      return;
    }
    const native = event.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const sources = coalesced.length > 0 ? coalesced : [native];
    for (const source of sources) {
      active.points.push(toWorld(source.clientX, source.clientY));
      if (
        !active.moved &&
        Math.hypot(source.clientX - active.startClient.x, source.clientY - active.startClient.y) >= DRAG_THRESHOLD_PX
      ) {
        active.moved = true;
      }
      if (active.points.length >= STROKE_MAX_POINTS) {
        // Hard cap: commit this part and continue the same gesture from the
        // shared last point (design pen.split).
        commit(active.points);
        active.points = [active.points[active.points.length - 1]];
      }
    }
    schedule();
  };

  // Release and interruption both commit what was drawn; a pointerup already
  // handled clears the capture, so the following lostpointercapture is a no-op.
  const finish = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const active = capture.current;
    if (active === null || event.pointerId !== active.pointerId) return;
    capture.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    commit(active.moved ? active.points : [active.points[0]]);
    setTick((t) => t + 1);
  };

  const active = capture.current;
  const zoom = props.camera.zoom > 0 ? props.camera.zoom : 1;
  const cursorSize = PEN_THICKNESS_WORLD[props.thickness] * zoom;
  const previewPath =
    active !== null && active.points.length > 0
      ? smoothPath(active.points.map((p) => worldToScreen(props.camera, p)))
      : '';

  return (
    <div
      ref={rootRef}
      data-testid="pen-tool-overlay"
      data-dragging={active !== null}
      style={{ position: 'absolute', inset: 0, zIndex: 45, cursor: 'none', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {previewPath !== '' ? (
        <svg
          data-testid="pen-preview"
          width="100%"
          height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
        >
          <path
            data-testid="pen-preview-path"
            d={previewPath}
            fill="none"
            stroke={PEN_COLORS[props.color]}
            strokeWidth={cursorSize}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      <span
        aria-hidden="true"
        data-testid="pen-cursor"
        style={{
          position: 'fixed',
          left: hover.current !== null ? hover.current.x : -1000,
          top: hover.current !== null ? hover.current.y : -1000,
          width: Math.max(cursorSize, 2),
          height: Math.max(cursorSize, 2),
          borderRadius: '50%',
          border: `1.5px solid ${PEN_COLORS[props.color]}`,
          background: 'rgba(33, 33, 33, 0.08)',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          boxSizing: 'border-box'
        }}
      />
    </div>
  );
}
