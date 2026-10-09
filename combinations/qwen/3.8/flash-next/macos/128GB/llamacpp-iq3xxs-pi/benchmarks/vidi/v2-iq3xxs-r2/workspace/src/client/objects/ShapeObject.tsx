import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { SHAPE_FILL_COLORS, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_COLORS } from '../../shared/config';
import { getShapeLabel, isShapeSnapshot, setShapeStyle, SHAPE_TYPE } from '../../shared/objects/shape';
import type { ShapeSnapshot } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import { SELECTION_OUTLINE, SELECTED_STACK_ABOVE } from './StickyNote';
import { TextEditor } from './TextEditor';
import { SHAPE_KIND_LABELS } from '../board/Toolbar';
import { ShapeToolbar } from './ShapeToolbar';
import type { EndEditNext } from '../board/useSelection';
import type { ObjectProps } from '../objects/registry';

/**
 * The label's font size and its padding, in board units. A shape's label is not auto-fitted
 * the way a sticky note's text is: the label box is the shape, so resizing the shape re-wraps
 * the label and keeps it centred (PRD: "resizing the shape re-wraps it and keeps it centred"),
 * and a font that changed size with the box would make that impossible to read.
 */
export const SHAPE_LABEL_FONT_WORLD = 16;
export const SHAPE_LABEL_PADDING_WORLD = 12;

/** The line the label wraps on, so it does not crawl up the shape when it wraps. */
export const SHAPE_LABEL_LINE_HEIGHT = 1.35;

/**
 * One shape: its outline and fill, its centred label, and — when this client has it alone
 * selected — the swatch toolbar under it.
 *
 * Like every other type since story 7 it implements no selection, dragging, resizing or
 * deleting of its own: `onObjectPointerDown` hands the press to the generic transform gesture,
 * which is what makes a shape and a sticky note move together when both are selected.
 *
 * The figure is an SVG sized to the object, and the label lives in a `foreignObject` sized to
 * the object as well, so both the label and its editor wrap in exactly the box the shape will
 * be drawn in — including while it is being typed into, which is when a wrong box shows up as
 * text jumping about under the caret.
 */
export function ShapeObject(props: ObjectProps): JSX.Element | null {
  // The registry hands every shape-ish object to this component; one that turned out to be
  // another type is not ours to draw.
  if (!isShapeSnapshot(props.object)) return null;
  return <ShapeObjectBody {...props} shape={props.object} />;
}

interface ShapeObjectBodyProps extends ObjectProps {
  shape: ShapeShape;
}

/** A shape read out of the document; `ObjectProps.object` narrowed by the check above. */
type ShapeShape = ShapeSnapshot;

function ShapeObjectBody({
  shape,
  doc,
  zoom,
  selected,
  selectedCount,
  editing,
  dragging,
  readOnly = false,
  onSelect,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
}: ShapeObjectBodyProps): JSX.Element {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const onEndEditRef = useRef(onEndEdit);
  onEndEditRef.current = onEndEdit;
  const undo = useUndoController();
  const ytext = useMemo(() => getShapeLabel(doc, shape.id), [doc, shape.id]);

  /*
   * The press/focus dance every type here has: a press focuses the object it landed on, and
   * that focus must not select anything, because the press has already decided the selection
   * and for Shift+click it decided something the focus handler could only undo.
   */
  const pressedRef = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.pointerType === 'touch') return;
    if (event.button !== 0) return;
    // The board must not start a pan from a shape (sel.no_pan), and neither may the label.
    event.stopPropagation();
    pressedRef.current = true;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'TEXTAREA') return; // let the caret move inside the editor
    if (editing) onEndEditRef.current('selected');
    onObjectPointerDown(event, shape.id);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The viewport would otherwise create a note here (TC-35).
    event.stopPropagation();
    if (editing || readOnly) return;
    onStartEdit(shape.id);
  };

  const onFocus = (event: ReactFocusEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (pressedRef.current) {
      pressedRef.current = false;
      return;
    }
    onSelect(shape.id);
  };

  const onBlur = (): void => {
    pressedRef.current = false;
  };

  // A pointerdown anywhere outside the shape ends editing (the board decides the selection).
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent): void => {
      const element = outerRef.current;
      const target = event.target as Node | null;
      if (!element || !target) return;
      if (element.contains(target)) return;
      onEndEditRef.current('unselected');
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown);
    };
  }, [editing]);

  const handleEndEdit = useCallback((next: EndEditNext): void => {
    onEndEditRef.current(next);
  }, []);

  /** A swatch is one undo step of its own, however fast the clicks come (undo.boundaries). */
  const handleFill = (fill: ShapeSnapshot['fill']): void => {
    undo?.boundary();
    setShapeStyle(doc, shape.id, { fill });
    undo?.boundary();
  };

  const handleStroke = (stroke: ShapeSnapshot['stroke']): void => {
    undo?.boundary();
    setShapeStyle(doc, shape.id, { stroke });
    undo?.boundary();
  };

  const showToolbar = selected && selectedCount === 1 && !editing && !dragging && !readOnly;

  /*
   * The stroke is drawn inside the box, so half of it is taken off the figure and the label
   * box. Without that an ellipse's edge would be cut by the edge of the SVG, which on a
   * diamond looks like a shape with two points missing.
   */
  const strokeWidth = shape.strokeWidth;
  const inset = strokeWidth / 2;
  const labelWidth = Math.max(0, shape.width - SHAPE_LABEL_PADDING_WORLD * 2);
  const labelHeight = Math.max(0, shape.height - SHAPE_LABEL_PADDING_WORLD * 2);

  const style = {
    left: `${shape.x}px`,
    top: `${shape.y}px`,
    width: `${shape.width}px`,
    height: `${shape.height}px`,
    zIndex: selected ? SELECTED_STACK_ABOVE : shape.z,
    outlineWidth: selected ? '2px' : '0',
    outlineColor: SELECTION_OUTLINE,
  } as CSSProperties;

  const kindLabel = SHAPE_KIND_LABELS[shape.kind];
  const ariaLabel = shape.label.length > 0 ? `${kindLabel} ${shape.label}` : kindLabel;

  return (
    <div
      ref={outerRef}
      className="vidi6-shape"
      data-testid="shape-object"
      data-note-id={shape.id}
      data-note-type={SHAPE_TYPE}
      data-shape-kind={shape.kind}
      data-shape-fill={shape.fill}
      data-shape-stroke={shape.stroke}
      data-note-x={shape.x}
      data-note-y={shape.y}
      data-note-z={shape.z}
      data-note-width={shape.width}
      data-note-height={shape.height}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      style={style}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <svg
        className="vidi6-shape-svg"
        data-testid="shape-svg"
        width={shape.width}
        height={shape.height}
        aria-hidden="true"
      >
        <ShapeFigure
          kind={shape.kind}
          width={shape.width}
          height={shape.height}
          inset={inset}
          strokeWidth={strokeWidth}
          fill={SHAPE_FILL_COLORS[shape.fill]}
          stroke={SHAPE_STROKE_COLORS[shape.stroke]}
        />
        {/* The label box is the shape, less its padding: that is what makes a resize
            re-wrap the label and keep it centred rather than move it about. */}
        <foreignObject
          x={SHAPE_LABEL_PADDING_WORLD}
          y={SHAPE_LABEL_PADDING_WORLD}
          width={labelWidth}
          height={labelHeight}
        >
          <div
            className="vidi6-shape-label"
            data-testid="shape-label"
            style={{
              width: `${labelWidth}px`,
              height: `${labelHeight}px`,
              fontSize: `${SHAPE_LABEL_FONT_WORLD}px`,
              lineHeight: SHAPE_LABEL_LINE_HEIGHT,
            }}
          >
            {editing && ytext ? (
              <TextEditor
                ytext={ytext}
                maxChars={SHAPE_LABEL_MAX_CHARS}
                fontPx={SHAPE_LABEL_FONT_WORLD}
                width={labelWidth}
                onEnd={handleEndEdit}
                undo={undo}
                className="vidi6-shape-editor"
                testId="shape-editor"
                ariaLabel={`${kindLabel} label`}
              />
            ) : (
              shape.label
            )}
          </div>
        </foreignObject>
      </svg>
      {showToolbar ? (
        <div
          className="vidi6-shape-toolbar-anchor"
          data-testid="shape-toolbar-anchor"
          style={{ transform: `scale(${1 / (zoom || 1)})` }}
        >
          <ShapeToolbar fill={shape.fill} stroke={shape.stroke} onFill={handleFill} onStroke={handleStroke} />
        </div>
      ) : null}
    </div>
  );
}

export interface ShapeFigureProps {
  kind: ShapeSnapshot['kind'];
  width: number;
  height: number;
  /** Half the stroke width: the amount the figure is pulled in so the outline stays inside. */
  inset: number;
  strokeWidth: number;
  /** The CSS colours the settings name, resolved by the caller. */
  fill: string;
  stroke: string;
}

/**
 * The three kinds, in the box they were drawn into (design: shape.ui). A diamond is a
 * polygon through the midpoints of the box's sides, which is also the shape whose outline
 * `sideAnchor` puts its connection points on — the dot sits where the arrow will join it.
 */
export function ShapeFigure({
  kind,
  width,
  height,
  inset,
  strokeWidth,
  fill,
  stroke,
}: ShapeFigureProps): JSX.Element {
  const x = inset;
  const y = inset;
  const w = Math.max(0, width - inset * 2);
  const h = Math.max(0, height - inset * 2);
  const shared = { fill, stroke, strokeWidth };
  if (kind === 'ellipse') {
    return <ellipse cx={width / 2} cy={height / 2} rx={w / 2} ry={h / 2} {...shared} />;
  }
  if (kind === 'diamond') {
    const points = `${width / 2},${x} ${width - x},${height / 2} ${width / 2},${height - y} ${x},${height / 2}`;
    return <polygon points={points} strokeLinejoin="round" {...shared} />;
  }
  return <rect x={x} y={y} width={w} height={h} {...shared} />;
}
