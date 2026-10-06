import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { objectBounds } from "../../shared/board-model";
import { SHAPE_LABEL_FONT_PX, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS } from "../../shared/config";
import { getShapeLabel, setShapeStyle, type ShapeSnap } from "../../shared/objects/shape";
import { TextEditor } from "./TextEditor";
import { ShapeToolbar } from "./ShapeToolbar";
import { useUndoBoundary, useUndoController } from "../board/useUndo";
import type { ObjectProps } from "./registry";

/**
 * One shape (`shape.ui`, story 10).
 *
 * Drawn in the world layer at its board rectangle, so it scales with the board
 * like everything else there: the outline is `SHAPE_STROKE_WIDTH_WORLD` board
 * units wide and its label is laid out in the shape's own width and height, which
 * is what makes the label re-wrap and stay centred when somebody drags a handle.
 *
 * The three kinds differ only in the figure drawn inside that rectangle — a
 * `rect`, an `ellipse`, or a `polygon` reaching the midpoints of the rect's four
 * sides — so resizing, selecting, moving and deleting stay the shared story 7
 * code, and the label lives in the same place for all three.
 *
 * Its gestures are not here: pressing hands the pointer to `useTransformGesture`,
 * exactly like a note or a text object. Double-clicking starts editing the label's
 * `Y.Text` with story 2's editor, clamped at `SHAPE_LABEL_MAX_CHARS`.
 */
export function ShapeObject({
  object,
  doc,
  zoom,
  selected,
  editing,
  dragging,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ObjectProps) {
  const id = object.id;
  const shape = object as ShapeSnap;
  const box = objectBounds(object);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const undoBoundary = useUndoBoundary();
  const undo = useUndoController();

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // A shape is moved, resized and selected by the same gesture as every other
    // board object.
    event.stopPropagation();
    onObjectPointerDown(event, id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    // Editing a shape's label, not creating another shape, and not a sticky note.
    event.stopPropagation();
    event.preventDefault();
    onStartEdit(id);
  };

  // A pointerdown outside the shape ends label editing — the same rule a text
  // object follows.
  useEffect(() => {
    if (!editing) return;
    const onOutsidePointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      if (el && event.target instanceof Node && el.contains(event.target)) return;
      onEndEdit("unselected");
    };
    document.addEventListener("pointerdown", onOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", onOutsidePointerDown);
  }, [editing, onEndEdit]);

  const ytext = editing ? getShapeLabel(doc, id) : undefined;
  const label = shape.label ?? "";
  const showToolbar = selected && !editing && !dragging;

  return (
    <div
      ref={rootRef}
      className="shape-object"
      data-testid="shape-object"
      data-object-type="shape"
      data-note-id={id}
      data-shape-kind={shape.kind}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      role="group"
      aria-label={`Shape, ${shape.kind}`}
      tabIndex={0}
      style={{
        left: `${round(box.x)}px`,
        top: `${round(box.y)}px`,
        width: `${round(box.width)}px`,
        height: `${round(box.height)}px`,
        zIndex: shape.z,
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg
        className="shape-svg"
        data-testid="shape-svg"
        width={round(box.width)}
        height={round(box.height)}
        viewBox={`0 0 ${round(box.width)} ${round(box.height)}`}
        aria-hidden="true"
      >
        <ShapeFigure kind={shape.kind} width={box.width} height={box.height} fill={shape.fill} stroke={shape.stroke} />
        <foreignObject x={0} y={0} width={round(box.width)} height={round(box.height)} className="shape-label-box">
          {ytext ? (
            <TextEditor
              ytext={ytext}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={SHAPE_LABEL_FONT_PX}
              width={box.width}
              onInput={() => undefined}
              onEnd={onEndEdit}
              undo={undo}
              className="shape-label shape-label-editor"
              testId="shape-label-input"
              ariaLabel="Shape label"
            />
          ) : (
            <div
              className="shape-label"
              data-testid="shape-label"
              style={{ fontSize: `${SHAPE_LABEL_FONT_PX}px` }}
            >
              {label}
            </div>
          )}
        </foreignObject>
      </svg>

      {showToolbar ? (
        <div
          ref={toolbarRef}
          className="shape-toolbar-anchor"
          data-testid="shape-toolbar-anchor"
          style={{ transform: `scale(${1 / zoomRef.current})` }}
        >
          <ShapeToolbar
            fill={shape.fill}
            stroke={shape.stroke}
            onFill={(fill) => {
              // One style change is one undo step.
              undoBoundary();
              setShapeStyle(doc, id, { fill });
              undoBoundary();
            }}
            onStroke={(strokeColour) => {
              undoBoundary();
              setShapeStyle(doc, id, { stroke: strokeColour });
              undoBoundary();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The figure inside the shape's rectangle: the whole rectangle for a rect and an
 * ellipse, and the four side midpoints for a diamond.
 */
function ShapeFigure({
  kind,
  width,
  height,
  fill,
  stroke,
}: {
  kind: string;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const common = {
    className: "shape-figure",
    fill: SHAPE_FILL_COLORS[fill as keyof typeof SHAPE_FILL_COLORS] ?? "none",
    stroke: SHAPE_STROKE_COLORS[stroke as keyof typeof SHAPE_STROKE_COLORS] ?? "currentColor",
    strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    "data-testid": `shape-figure-${kind}`,
  };

  if (kind === "ellipse") {
    return <ellipse {...common} cx={halfWidth} cy={halfHeight} rx={halfWidth} ry={halfHeight} />;
  }
  if (kind === "diamond") {
    const points = `${halfWidth},0 ${width},${halfHeight} ${halfWidth},${height} 0,${halfHeight}`;
    return <polygon {...common} points={points} />;
  }
  return <rect {...common} x={0} y={0} width={round(width)} height={round(height)} />;
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
