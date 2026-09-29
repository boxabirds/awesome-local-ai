// A shape (story 10 `shape.ui`): a rectangle, ellipse or diamond with a centred label.
//
// It renders inside the zoomed world layer at its stored box, drawn as one SVG element
// — `rect`, `ellipse` or a `polygon` — with the shape's fill and outline and
// `SHAPE_STROKE_WIDTH_WORLD` thickness. The three kinds share the same box, so the
// generic selection, move, resize, nudge, delete and undo of stories 7 and 8 all work
// on it untouched; this component adds no selection code of its own.
//
// The label lives in an HTML layer on top of the drawing, not inside the SVG: it is a
// box of the shape's own width and height, centred on both axes, that wraps as it
// grows and re-wraps when the shape is resized — because the box *is* the object's
// size, re-wrapping is free. Editing it opens the shared `TextEditor` (story 9), so a
// label clamps to `SHAPE_LABEL_MAX_CHARS`, merges a colleague's concurrent typing and
// routes Ctrl/Cmd+Z to this tab's history. An empty label keeps the shape: unlike a
// free text, a shape with no text is still a shape.

import { useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ObjectProps, ObjectToolbarProps } from './registry.tsx';
import { objectBounds } from '../../shared/board-model.ts';
import {
  asShapeSnapshot,
  getShapeLabel,
  setShapeStyle,
  type ShapeSnapshot,
} from '../../shared/objects/shape.ts';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  STICKY_FONT_MAX_PX,
  type FillColor,
  type StrokeColor,
} from '../../shared/config.ts';
import { TextEditor } from './TextEditor.tsx';
import { fitFontSize } from './StickyText.ts';
import { ShapeToolbar } from './ShapeToolbar.tsx';
import { useUndoController, useUndoBoundary } from '../board/useUndo.ts';

const PADDING = 10;
const LINE_HEIGHT = 1.25;

/** What each kind is called out as, for the accessible name of the object. */
const KIND_NAMES: Record<ShapeSnapshot['kind'], string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
};

export interface ShapeObjectProps extends ObjectProps {}

/** The SVG element of one kind, drawn inside a `w` × `h` box. */
function shapeElement(
  kind: ShapeSnapshot['kind'],
  w: number,
  h: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
) {
  // The outline straddles the path, so every kind is inset by half its thickness and
  // stays inside the object's box (the selection box then hugs what is drawn).
  const i = strokeWidth / 2;
  const common = { fill, stroke, strokeWidth } as const;
  if (kind === 'ellipse') {
    return (
      <ellipse
        data-testid="shape-ellipse"
        cx={w / 2}
        cy={h / 2}
        rx={Math.max(0, w / 2 - i)}
        ry={Math.max(0, h / 2 - i)}
        {...common}
      />
    );
  }
  if (kind === 'diamond') {
    const points = `${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`;
    return <polygon data-testid="shape-diamond" points={points} {...common} />;
  }
  return (
    <rect
      data-testid="shape-rect"
      x={i}
      y={i}
      width={Math.max(0, w - strokeWidth)}
      height={Math.max(0, h - strokeWidth)}
      {...common}
    />
  );
}

/**
 * A shape: its outline and fill, plus the centred, wrapping, editable label.
 */
export function ShapeObject(props: ShapeObjectProps) {
  const { obj, doc, selected, editing, onEndEdit } = props;
  const canEdit = props.canEdit ?? true;
  const shape = asShapeSnapshot(obj);
  const bounds = objectBounds(obj);
  const label = shape.label;
  const fill = SHAPE_FILL_COLORS[shape.fill] as string;
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] as string;
  const innerWidth = Math.max(1, bounds.width - PADDING * 2);
  const innerHeight = Math.max(1, bounds.height - PADDING * 2);
  const undo = useUndoController();

  const measureRef = useRef<HTMLDivElement | null>(null);
  const [fit, setFit] = useState({ fontPx: STICKY_FONT_MAX_PX, overflow: false });
  // The label's font auto-fits the shape's box, exactly as a note's text does: a big
  // shape gets a big label, and resizing re-fits it instead of stretching it.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    setFit(fitFontSize(el, innerHeight));
  }, [label, innerWidth, innerHeight]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return; // the label's textarea owns its own pointer events
    props.onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation(); // never create a shape or text behind it
    if (!canEdit) return; // editing is locked on an unloadable board
    props.onObjectDoubleClick(e, obj.id);
  };

  const ytext = editing ? getShapeLabel(doc as Y.Doc, shape.id) : undefined;

  return (
    <div
      role="group"
      aria-label={`${KIND_NAMES[shape.kind]} shape`}
      data-selected={selected ? 'true' : 'false'}
      data-shape-id={shape.id}
      data-kind={shape.kind}
      data-testid="shape-object"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      style={{
        position: 'absolute',
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        boxSizing: 'border-box',
        zIndex: obj.z,
        pointerEvents: 'auto',
        cursor: 'grab',
        color: '#263238',
        outline: selected ? '2px solid #2f6fed' : 'none',
        outlineOffset: 2,
        userSelect: editing ? 'text' : 'none',
      }}
    >
      <svg
        data-testid="shape-svg"
        width={bounds.width}
        height={bounds.height}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {shapeElement(
          shape.kind,
          bounds.width,
          bounds.height,
          fill,
          stroke,
          SHAPE_STROKE_WIDTH_WORLD,
        )}
      </svg>

      <div
        data-testid="shape-label"
        style={{
          position: 'absolute',
          inset: PADDING,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {editing && ytext ? (
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={fit.fontPx}
            width="auto"
            onInput={() => {}}
            onEnd={onEndEdit}
            undo={undo!}
            limitHint={`Limit reached · ${SHAPE_LABEL_MAX_CHARS} characters`}
            testId="shape-label-editor"
            textAlign="center"
          />
        ) : (
          <div
            data-testid="shape-label-text"
            style={{
              width: '100%',
              fontSize: fit.fontPx,
              lineHeight: LINE_HEIGHT,
              textAlign: 'center',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              wordBreak: 'break-word',
              boxSizing: 'border-box',
            }}
          >
            {label}
          </div>
        )}
      </div>

      {/* Off-screen measurement element for the label's font auto-fit: the shape's own
          inner box, so the fit follows the shape's size. */}
      <div
        ref={measureRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: innerWidth,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
          lineHeight: LINE_HEIGHT,
          fontSize: `${fit.fontPx}px`,
          boxSizing: 'border-box',
        }}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * The toolbar of one selected shape: the fill and outline swatches and Delete. Each
 * swatch writes one field of the document and closes its own undo step.
 */
export function ShapeObjectToolbar(props: ObjectToolbarProps) {
  const shape = asShapeSnapshot(props.obj);
  const boundary = useUndoBoundary();
  const onFill = (fill: FillColor) => {
    if (!props.canEdit) return;
    boundary();
    setShapeStyle(props.doc, shape.id, { fill });
    boundary();
  };
  const onStroke = (stroke: StrokeColor) => {
    if (!props.canEdit) return;
    boundary();
    setShapeStyle(props.doc, shape.id, { stroke });
    boundary();
  };
  return (
    <ShapeToolbar
      fill={shape.fill}
      stroke={shape.stroke}
      onFill={onFill}
      onStroke={onStroke}
      onDelete={() => props.onDelete?.()}
      canEdit={props.canEdit}
    />
  );
}

// `objects/registry.tsx` registers this component as the 'shape' type.
export default ShapeObject;
