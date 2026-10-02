import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type * as Y from 'yjs';
import type { ShapeSnapshot } from '../../shared/board-model';
import {
  DRAG_THRESHOLD_PX,
  SHAPE_LABEL_FONT_PX_WORLD,
  SHAPE_LABEL_LINE_HEIGHT,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  type ShapeFillColor,
  type ShapeStrokeColor,
} from '../../shared/config';
import { getShapeLabel, setShapeStyle } from '../../shared/objects/shape';
import type { EndEditNext } from '../board/useSelection';
import type { UndoController } from '../board/undo';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';

export interface ShapeObjectProps {
  /** The shape as stored: place, box, kind, colours, label. */
  obj: ShapeSnapshot;
  doc: Y.Doc;
  /** Camera zoom: the outline scales with the board, the toolbar does not. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False only while the board cannot be edited. */
  canEdit?: boolean;
  onSelect(id: string): void;
  /** Shift+click toggles the shape in and out of the selection. */
  onToggle?(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: EndEditNext): void;
  /** Transform gesture handlers: called for pointer events on this object. */
  onGesturePointerDown?(e: ReactPointerEvent<HTMLDivElement>, id: string): void;
  onGesturePointerMove?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerUp?(e: ReactPointerEvent<HTMLDivElement>): void;
  onGesturePointerCancel?(e: ReactPointerEvent<HTMLDivElement>): void;
  /** This person's own undo history, handed to the editor and the toolbar. */
  undo?: UndoController;
}

/**
 * One shape: a rectangle, an ellipse or a diamond, with a label that stays in the
 * middle of it (design section 5.2).
 *
 * The figure is SVG, drawn in the shape's own box, so the board's one CSS
 * transform does all the scaling and a shape at 10 % is the same drawing with
 * fewer pixels. The label is laid out by the browser in a box the shape's size
 * gives it, which is what makes it wrap when it grows too long for one line and
 * re-wrap when a handle makes the box narrower — no measurement, no stored line
 * count, nothing that can disagree with the box it is drawn in.
 *
 * Selection, dragging and resizing are the transform gesture's, exactly as a
 * sticky note's and a text object's: this component only decides what a press on
 * it means and what its label and colours are drawn with.
 */
export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const { obj, doc, selected, editing, zoom } = props;
  const propsRef = useRef(props);
  const [pressed, setPressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gestureActiveRef = useRef(false);
  const startXYRef = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (propsRef.current.editing) {
      // The caret's business, inside the label's own textarea.
      e.stopPropagation();
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A press on a shape is never a pan: the viewport must not see it.
    e.stopPropagation();
    if (e.shiftKey) {
      propsRef.current.onToggle?.(obj.id);
      return;
    }
    setPressed(true);
    gestureActiveRef.current = true;
    startXYRef.current = { x: e.clientX, y: e.clientY };
    propsRef.current.onGesturePointerDown?.(e, obj.id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureActiveRef.current) return;
    e.stopPropagation();
    propsRef.current.onGesturePointerMove?.(e);
    if (!dragging && startXYRef.current !== null) {
      const dx = e.clientX - startXYRef.current.x;
      const dy = e.clientY - startXYRef.current.y;
      if (Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) setDragging(true);
    }
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!gestureActiveRef.current) return;
    e.stopPropagation();
    gestureActiveRef.current = false;
    setPressed(false);
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.type === 'pointerup') propsRef.current.onGesturePointerUp?.(e);
    else propsRef.current.onGesturePointerCancel?.(e);
    // A press that did not become a drag has selected the shape.
    propsRef.current.onSelect(obj.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Editing this shape's label; the viewport must not create another object here.
    e.stopPropagation();
    if (propsRef.current.canEdit === false) return;
    propsRef.current.onStartEdit(obj.id);
  };

  /**
   * One swatch is one step of mine, closed on both sides of it: neither the
   * typing before it nor the drag after it is merged into the act of painting,
   * and two swatches clicked one after the other are two things to undo.
   */
  const paint = (style: { fill?: string; stroke?: string }): void => {
    if (propsRef.current.canEdit === false) return;
    propsRef.current.undo?.boundary();
    setShapeStyle(doc, obj.id, style);
    propsRef.current.undo?.boundary();
  };

  const onFill = (color: ShapeFillColor) => {
    paint({ fill: color });
  };

  const onStroke = (color: ShapeStrokeColor) => {
    paint({ stroke: color });
  };

  const endEdit = useCallback((next: EndEditNext) => {
    propsRef.current.onEndEdit(next);
  }, []);

  const ytext = getShapeLabel(doc, obj.id);
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;
  // The label is laid out in the box the shape has, less the outline: the line
  // is drawn half inside the box, so the words start where the line ends.
  const labelPad = strokeWidth + 4;
  const state = editing ? 'editing' : dragging ? 'dragging' : pressed ? 'pressed' : selected ? 'selected' : 'unselected';

  const style = {
    left: `${obj.x}px`,
    top: `${obj.y}px`,
    width: `${obj.width}px`,
    height: `${obj.height}px`,
    fontSize: `${SHAPE_LABEL_FONT_PX_WORLD}px`,
    lineHeight: String(SHAPE_LABEL_LINE_HEIGHT),
    zIndex: obj.z,
    // The toolbar is the size of the screen it is looked at with, not of the
    // board it is drawn on: this is the whole of how a swatch stays a swatch.
    '--shape-inv-zoom': String(1 / (zoom > 0 ? zoom : 1)),
  } as CSSProperties;

  return (
    <div
      className={`shape-object${editing ? ' is-editing' : ''}`}
      data-shape-id={obj.id}
      data-kind={obj.kind}
      data-selected={selected ? 'true' : 'false'}
      data-state={state}
      data-testid="shape-object"
      role="group"
      aria-label="Shape"
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onLostPointerCapture={endPress}
      onDoubleClick={onDoubleClick}
    >
      <Figure obj={obj} strokeWidth={strokeWidth} />
      <div
        className="shape-label"
        data-testid="shape-label"
        data-label-length={obj.label.length}
        aria-hidden={editing ? 'true' : undefined}
        style={{ padding: `${labelPad}px` }}
      >
        {obj.label}
      </div>
      {editing && ytext !== undefined ? (
        <TextEditor
          ytext={ytext}
          id={obj.id}
          fontPx={SHAPE_LABEL_FONT_PX_WORLD}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          objectSelector="[data-shape-id]"
          testId="shape-label-editor"
          remeasure={noop}
          undo={props.undo}
          onEnd={(next) => {
            endEdit(next);
          }}
        />
      ) : null}
      {selected && !editing ? (
        <ShapeToolbar fill={obj.fill} stroke={obj.stroke} onFill={onFill} onStroke={onStroke} />
      ) : null}
    </div>
  );
}

/** A shape that needs no measuring: its box is its own, and its words are laid
 *  out inside it rather than the other way round. */
function noop(): void {}

/**
 * The figure itself, in the shape's box: one SVG, drawn in world units so the
 * board's transform scales it.
 *
 * Every figure is inset by half the outline width, so a line of two units stands
 * with its middle on the box's edge and none of it is clipped by the box it is
 * drawn in. The three kinds share their box, their colours and their line: what
 * differs is only the path.
 */
function Figure(props: { obj: ShapeSnapshot; strokeWidth: number }): JSX.Element {
  const { obj, strokeWidth } = props;
  const w = obj.width;
  const h = obj.height;
  const half = strokeWidth / 2;
  const fill = SHAPE_FILL_COLORS[obj.fill];
  const stroke = SHAPE_STROKE_COLORS[obj.stroke];
  const paint = { fill, stroke, strokeWidth } as const;

  return (
    <svg
      className="shape-svg"
      data-testid="shape-svg"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      {obj.kind === 'ellipse' ? (
        <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - half)} ry={Math.max(0, h / 2 - half)} {...paint} />
      ) : obj.kind === 'diamond' ? (
        <polygon
          points={`${w / 2},${half} ${w - half},${h / 2} ${w / 2},${h - half} ${half},${h / 2}`}
          {...paint}
        />
      ) : (
        <rect
          x={half}
          y={half}
          width={Math.max(0, w - strokeWidth)}
          height={Math.max(0, h - strokeWidth)}
          {...paint}
        />
      )}
    </svg>
  );
}
