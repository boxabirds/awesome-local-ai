import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_SIZES,
  type FillColor,
  type StrokeColor,
} from '../../shared/config';
import { getShapeLabel, setShapeStyle, type ShapeSnap } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';
import type { UndoController } from '../board/undo';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  /** Camera zoom, so the toolbar keeps its screen size and a drag keeps its grip. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  /** False while the board cannot be edited (it failed to load): the shape is inert. */
  editable?: boolean;
  /** Whether this shape is currently being dragged by the transform gesture. */
  dragging?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Story 7: delegated pointerdown for the transform gesture. */
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  /** This tab's undo history (story 8): a colour change is a step of its own. */
  undo?: UndoController;
}

/** A label is written in the same medium free-text size, so both look alike. */
export const SHAPE_LABEL_FONT_PX = TEXT_SIZES.M;

/** The fill colour, or transparent for a shape with no fill. */
export function shapeFillColor(fill: FillColor): string {
  return SHAPE_FILL_COLORS[fill];
}

/** The outline colour. */
export function shapeStrokeColor(stroke: StrokeColor): string {
  return SHAPE_STROKE_COLORS[stroke];
}

/**
 * One shape on the board (PRD shape.create_drag, shape.label, shape.style).
 *
 * The SVG is the object's own box, so moving and resizing it (story 7) moves and
 * resizes the drawing with no extra work; the label sits in a `foreignObject` sized
 * to the same box and centred in both directions, which is what makes a label
 * re-wrap and stay centred when the shape is resized. Move, resize and delete are
 * the generic ones: this component only paints, gestures and styles.
 */
export function ShapeObject({
  shape,
  doc,
  zoom,
  selected,
  editing,
  editable = true,
  dragging = false,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  undo,
}: ShapeObjectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const live = useRef({ shape, editable, onSelect, onStartEdit, onObjectPointerDown });
  live.current = { shape, editable, onSelect, onStartEdit, onObjectPointerDown };

  // Select, drag and double-click behave exactly like a sticky note (PRD "Constraints").
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const inside = (target: EventTarget | null, selector: string): boolean =>
      target instanceof Element && target.closest(selector) !== null;

    const onPointerDown = (event: PointerEvent): void => {
      if (live.current.editable === false) return;
      if (event.button !== 0) return;
      if (inside(event.target, '.shape-label-input')) return;
      if (inside(event.target, '.shape-toolbar')) return;
      if (inside(event.target, '.selection-handle')) return;
      event.stopPropagation();
      if (live.current.onObjectPointerDown) {
        live.current.onObjectPointerDown(event, live.current.shape.id);
      } else {
        live.current.onSelect(live.current.shape.id);
      }
    };

    const onDoubleClick = (event: MouseEvent): void => {
      if (live.current.editable === false) return;
      event.stopPropagation();
      event.preventDefault();
      live.current.onStartEdit(live.current.shape.id);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, []);

  const width = shape.width;
  const height = shape.height;
  // The outline is drawn centred on the edge, so the shape is inset by half of it and
  // stays inside its box at every zoom.
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const inset = sw / 2;
  const fill = shapeFillColor(shape.fill);
  const stroke = shapeStrokeColor(shape.stroke);
  const showToolbar = selected && !editing;
  // The label is a shared Y.Text, so two people typing in one label merge by
  // character (PRD shape.label); only the editor needs the object itself.
  const labelYText = editing ? getShapeLabel(doc, shape.id) : undefined;

  return (
    <div
      ref={rootRef}
      className="shape-object"
      data-object-root=""
      data-shape-root=""
      data-shape-id={shape.id}
      data-testid="shape-object"
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-kind={shape.kind}
      role="group"
      aria-label={`${shape.kind} shape`}
      tabIndex={0}
      style={{
        left: shape.x,
        top: shape.y,
        width,
        height,
        outline: selected ? '2px solid #1a73e8' : 'none',
      }}
    >
      <svg
        className="shape-svg"
        data-testid="shape-svg"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
      >
        {shape.kind === 'rect' ? (
          <rect
            data-testid="shape-figure"
            x={inset}
            y={inset}
            width={Math.max(width - sw, 0)}
            height={Math.max(height - sw, 0)}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        ) : null}
        {shape.kind === 'ellipse' ? (
          <ellipse
            data-testid="shape-figure"
            cx={width / 2}
            cy={height / 2}
            rx={Math.max((width - sw) / 2, 0)}
            ry={Math.max((height - sw) / 2, 0)}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        ) : null}
        {shape.kind === 'diamond' ? (
          <polygon
            data-testid="shape-figure"
            points={`${width / 2},${inset} ${width - inset},${height / 2} ${width / 2},${height - inset} ${inset},${height / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        ) : null}
        {/* The label is HTML in the object's own box: centred both ways, and re-wrapped
            by the browser whenever the box changes (PRD shape.label). */}
        <foreignObject x={0} y={0} width={width} height={height}>
          {editing && labelYText instanceof Y.Text ? (
            <TextEditor
              key={shape.id}
              ytext={labelYText}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={SHAPE_LABEL_FONT_PX}
              width="fill"
              onEnd={onEndEdit}
              undo={undo}
              rootSelector="[data-shape-root]"
              inputClassName="shape-label-input"
              inputTestId="shape-label-input"
              inputAriaLabel="Shape label"
            />
          ) : (
            <div
              className="shape-label"
              data-testid="shape-label"
              style={{
                fontSize: `${SHAPE_LABEL_FONT_PX}px`,
                fontFamily: TEXT_FONT_FAMILY,
                lineHeight: TEXT_LINE_HEIGHT,
              }}
            >
              <span className="shape-label-inner" data-testid="shape-label-inner">
                {shape.label}
              </span>
            </div>
          )}
        </foreignObject>
      </svg>

      {showToolbar ? (
        <div
          className="shape-toolbar-anchor"
          style={{
            left: width / 2,
            top: 0,
            transform: `scale(${1 / (zoom > 0 ? zoom : 1)})`,
          }}
        >
          <ShapeToolbar
            fill={shape.fill}
            stroke={shape.stroke}
            disabled={!editable}
            onFill={(next) => {
              if (!editable) return;
              undo?.boundary();
              setShapeStyle(doc, shape.id, { fill: next });
              undo?.boundary();
            }}
            onStroke={(next) => {
              if (!editable) return;
              undo?.boundary();
              setShapeStyle(doc, shape.id, { stroke: next });
              undo?.boundary();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
