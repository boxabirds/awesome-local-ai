/**
 * Story 11 · task 16 — the stroke object (design "StrokeObject", PRD
 * `pen.select`, `pen.smooth`, `pen.resize`).
 *
 * A sketch is one absolutely positioned `div[role=group]` in the (scaled) world
 * layer, with three targets inside it:
 *
 *  - `stroke-hit`: an invisible stroke as wide as the selection tolerance
 *    (the larger of half the ink and `STROKE_HIT_TOLERANCE_PX` screen pixels,
 *    divided by the zoom so precision does not depend on the zoom level);
 *  - `stroke-visible`: the actual ink at `thickness` world units;
 *  - when selected, the eight resize handles and the pen options.
 *
 * A point **inside the bounding box but far from the path selects nothing**: the
 * wrapper never captures the pointer, and only the hit stroke does, so a click in
 * the empty half of a loop falls through to whatever is underneath (PRD
 * `pen.select`). The path itself comes from {@link smoothPath}, so a polyline of
 * corners draws as a hand-drawn line, and from {@link scaledPoints}, so a
 * proportional resize of the box re-scales the drawing with the ink width
 * untouched (PRD `pen.resize`).
 *
 * A press on the ink runs through the board's one {@link useObjectInteraction}
 * hook, exactly like a note or a shape: a click selects the sketch and a press
 * that travels past the drag threshold moves it (on its own, or with everything
 * else in the selection). Nothing about a sketch is transformed in this file.
 */
import { useRef, type JSX, type PointerEvent as ReactPointerEvent } from 'react';
import type { ObjectSnapshot } from '../../shared/board-model';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  PEN_COLORS,
  STROKE_HIT_TOLERANCE_PX,
} from '../../shared/config';
import { smoothPath } from '../../shared/geometry/simplify';
import { scaledPoints, strokeThicknessWorld } from '../../shared/objects/stroke';
import { PenToolbar } from './PenToolbar';
import { useObjectInteraction } from './useObjectInteraction';
import type { TransformController } from '../board/transformController';
import type { Handle } from '../../shared/geometry';

export interface StrokeObjectProps {
  /** The stroke snapshot; `points` are relative to its own box. */
  obj: ObjectSnapshot;
  zoom: number;
  selected: boolean;
  /** False on a read-only board: no selection, no handles, no restyle. */
  editable?: boolean;
  controller: TransformController;
  /** The current selection, so a handle drags the whole group. */
  selection: readonly string[];
  onSelect(id: string, additive: boolean): void;
  /** Restyle this sketch (the parent runs it in one undo step). */
  onStyle?(style: { color?: string; thickness?: string }): void;
}

/** The eight resize handles, corner-first (the order the design names). */
const HANDLES: ReadonlyArray<{ key: Handle; x: number; y: number; cursor: string }> = [
  { key: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { key: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { key: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { key: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { key: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { key: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { key: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { key: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

/** Handle edge length in screen pixels (constant at any zoom). */
const HANDLE_PX = 8;

export function StrokeObject(props: StrokeObjectProps): JSX.Element | null {
  const { obj, zoom, selected, onSelect } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const editable = props.editable ?? true;
  const inverse = zoom > 0 ? 1 / zoom : 1;

  const points = scaledPoints(obj);
  const id = obj.id;

  // One gesture path for every board object: a click selects, a drag that clears
  // the threshold moves this sketch — or the whole selection, if it is part of one
  // — through the board's single transform controller.
  const interaction = useObjectInteraction({
    id,
    isEditable: () => editable,
    isEditing: () => false,
    getSelection: () => props.selection,
    onSelect: (pressedId, additive) => onSelect(pressedId, additive),
    getController: () => props.controller,
  });

  // A damaged or empty recording draws nothing rather than a dot at the origin
  // (the model already refuses to store one; this covers a document written by
  // somebody else).
  if (points.length < 1) return null;

  const width = Math.max(obj.width, 1);
  const height = Math.max(obj.height, 1);
  const colorToken = obj.ink ?? DEFAULT_PEN_COLOR;
  const thicknessToken = obj.thickness ?? DEFAULT_PEN_THICKNESS;
  const color = (PEN_COLORS as Record<string, string>)[colorToken] ?? PEN_COLORS[DEFAULT_PEN_COLOR];
  const thickness = strokeThicknessWorld(thicknessToken);

  // Local coordinates: the stored path is already relative to the box origin, so
  // the only transform is the resize scale baked into `scaledPoints`.
  const local = points.map((p) => ({ x: p.x - obj.x, y: p.y - obj.y }));
  const d = smoothPath(local);

  // The hit stroke is as wide as the selection tolerance, which is at least half
  // the ink: a 12-unit-thick sketch is selectable 6 units outside its edge.
  const hitWidth =
    Math.max(thickness / 2, STROKE_HIT_TOLERANCE_PX * inverse) * 2;

  const startHandle = (handle: Handle) => (event: ReactPointerEvent<SVGElement>) => {
    event.stopPropagation();
    if (!editable) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom: capture is skipped; the handlers still fire in order.
    }
    const ids = props.selection.length > 0 ? props.selection : [id];
    props.controller.beginResize(handle, ids, event.clientX, event.clientY);
  };

  const moveHandle = (event: ReactPointerEvent<SVGElement>) => {
    if (!props.controller.isActive()) return;
    event.stopPropagation();
    props.controller.resize(event.clientX, event.clientY);
  };

  const endHandle = (event: ReactPointerEvent<SVGElement>) => {
    if (!props.controller.isActive()) return;
    event.stopPropagation();
    props.controller.end();
  };

  const lone = selected && props.selection.length <= 1;

  return (
    <div
      role="group"
      // PRD pen.options accessibility: a sketch is announced as "Drawing". It is a
      // group, not an image, because the options row and the handles that live
      // inside it have to stay reachable (the shape and the note do the same).
      aria-label="Drawing"
      data-testid="stroke"
      data-stroke-id={id}
      data-selected={selected ? 'true' : 'false'}
      data-editable={editable ? 'true' : 'false'}
      data-color={colorToken}
      data-width={thicknessToken}
      className={selected ? 'stroke stroke-selected' : 'stroke'}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${width}px`,
        height: `${height}px`,
        // The wrapper never captures: only the hit stroke and the handles do, so
        // an empty part of the box is a clear miss (PRD `pen.select`).
        pointerEvents: 'none',
        outline: selected ? `${2 * inverse}px solid #2f6fed` : 'none',
      }}
    >
      <svg
        ref={svgRef}
        data-testid="stroke-svg"
        width={width}
        height={height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        <path
          data-testid="stroke-hit"
          data-phase={interaction.phase}
          d={d}
          fill="none"
          stroke="transparent"
          strokeWidth={hitWidth}
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onPointerDown={interaction.onPointerDown}
          onPointerMove={interaction.onPointerMove}
          onPointerUp={interaction.onPointerEnd}
          onPointerCancel={interaction.onPointerEnd}
        />
        <path
          data-testid="stroke-visible"
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        />
        {lone && editable
          ? HANDLES.map((handle) => {
              const size = HANDLE_PX * inverse;
              const cx = handle.x * width;
              const cy = handle.y * height;
              return (
                <rect
                  key={handle.key}
                  data-testid={`stroke-handle-${handle.key}`}
                  data-handle={handle.key}
                  className="stroke-resize-handle"
                  x={cx - size / 2}
                  y={cy - size / 2}
                  width={size}
                  height={size}
                  fill="#ffffff"
                  stroke="#2f6fed"
                  strokeWidth={inverse}
                  style={{
                    pointerEvents: 'all',
                    cursor: handle.cursor,
                    touchAction: 'none',
                  }}
                  onPointerDown={startHandle(handle.key)}
                  onPointerMove={moveHandle}
                  onPointerUp={endHandle}
                  onPointerCancel={endHandle}
                  onLostPointerCapture={endHandle}
                />
              );
            })
          : null}
      </svg>

      {lone && editable ? (
        <div
          className="stroke-toolbar-anchor"
          style={{
            position: 'absolute',
            top: `${-44 * inverse}px`,
            left: '0px',
            transform: `scale(${inverse})`,
            transformOrigin: 'top left',
            pointerEvents: 'auto',
          }}
        >
          <PenToolbar
            color={colorToken}
            thickness={thicknessToken}
            testId="stroke-toolbar"
            onColor={(next) => props.onStyle?.({ color: next })}
            onThickness={(next) => props.onStyle?.({ thickness: next })}
          />
        </div>
      ) : null}
    </div>
  );
}
