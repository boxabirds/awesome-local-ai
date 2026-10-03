// A shape (story 10). Like the sticky note and the free text object it is *only* a
// renderer and a label host: selecting, moving, nudging, marquee-ing, resizing, deleting
// and undo all arrive through the registry from stories 7 and 8, so a shape behaves
// exactly like every other object there (shape.consistent) and this file holds no
// selection or transform code of its own.
//
// What is shape-specific:
//  - the outline is SVG inside the object's own box, so a rectangle, an ellipse and a
//    diamond are three paths and one set of numbers — the box is the stored x/y/width/
//    height and nothing else measures it;
//  - the fill and the outline are stored as small names, so a board that never heard of
//    them still paints: the defaults are read at the door (`shapeFromMap`);
//  - the label is a shared `Y.Text` edited by story 9's `TextEditor`, so the character
//    budget, IME handling, two-person typing and Ctrl+Z inside the field are the
//    behaviour the board already had — only the budget, the box and the wrapping differ;
//  - the fill/outline/bin toolbar shows only when this shape is the sole selection,
//    counter-scaled by 1/zoom like the note's, so it stays the same size on screen.

import { useCallback, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_KIND_NAMES,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type FillColor,
  type ShapeKind,
  type StrokeColor,
} from '../../shared/config';
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import type { ObjectProps } from './registry';
import { useUndoController } from '../board/useUndo';
import { TextEditor } from './TextEditor';
import { ShapeToolbar } from './ShapeToolbar';

export type ShapeObjectProps = ObjectProps;

/**
 * The outline of one shape, drawn in its own box (a 0 0 w h viewBox). The stroke is
 * inset by half its width so a shape that fills its box still shows all of its outline.
 * The colour lives on the surrounding <g>, so there is one place where a shape is painted.
 */
/**
 * The outline of a shape kind, in an SVG whose viewBox is the shape's own box.
 *
 * Exported because the Shape tool's preview is drawn with this and nothing else: a preview
 * that is a square with a label saying 'diamond' tells a lie about what is going to appear,
 * so both the preview and the object ask the same component for the geometry.
 */
export function ShapeFigure({ kind, w, h, sw }: { kind: ShapeKind; w: number; h: number; sw: number }) {
  const rw = Math.max(w - sw, 1);
  const rh = Math.max(h - sw, 1);
  if (kind === 'ellipse') {
    return <ellipse cx={w / 2} cy={h / 2} rx={rw / 2} ry={rh / 2} />;
  }
  if (kind === 'diamond') {
    const points = `${w / 2},${sw / 2} ${w - sw / 2},${h / 2} ${w / 2},${h - sw / 2} ${sw / 2},${h / 2}`;
    return <polygon points={points} />;
  }
  return <rect x={sw / 2} y={sw / 2} width={rw} height={rh} rx={2} />;
}

export function ShapeObject(props: ShapeObjectProps) {
  const {
    obj,
    doc,
    zoom,
    selected,
    sole,
    editing,
    canEdit,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
    onDelete,
    onStyle,
  } = props;
  const shape = obj as ShapeSnap;
  const undo = useUndoController();

  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!canEdit) return; // typing a label is a board mutation
    if (!editing) onStartEdit(shape.id);
  };

  // The toolbar's swatches go through the board, because a colour is a write to the shared
  // document and this component does not own one. An object rendered without that callback
  // (a preview, a test) simply cannot be repainted.
  const paintFill = useCallback(
    (fill: FillColor) => onStyle?.(shape.id, { fill }),
    [onStyle, shape.id],
  );
  const paintStroke = useCallback(
    (stroke: StrokeColor) => onStyle?.(shape.id, { stroke }),
    [onStyle, shape.id],
  );

  // The label's Y.Text is fetched only while it is being edited: the snapshot already
  // carries the string for display, and asking for the shared type creates it if absent.
  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;

  const w = shape.width;
  const h = shape.height;
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const fill = shape.fill === 'none' ? 'none' : SHAPE_FILL_COLORS[shape.fill];
  const stroke = SHAPE_STROKE_COLORS[shape.stroke];
  const showToolbar = sole && !editing;

  return (
    <div
      role="group"
      aria-label={
        shape.label.trim() === ''
          ? SHAPE_KIND_NAMES[shape.kind]
          : `${SHAPE_KIND_NAMES[shape.kind]}: ${shape.label}`
      }
      data-shape-id={shape.id}
      data-object-id={shape.id}
      data-shape-kind={shape.kind}
      data-selected={selected ? 'true' : 'false'}
      data-testid={`shape-${shape.id}`}
      tabIndex={0}
      className="shape-object"
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: w,
        height: h,
        zIndex: shape.z,
        pointerEvents: 'auto',
      }}
      onPointerDown={(e) => onObjectPointerDown(e, shape.id)}
      onDoubleClick={handleDoubleClick}
    >
      {/* The outline. `overflow: visible` so a stroke on the edge is not clipped by the
          box; `pointer-events: none` so every press reaches the div story 7's gesture
          listens on, exactly as it does for a note. */}
      <svg
        data-testid={`shape-figure-${shape.id}`}
        data-shape-figure="true"
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
      >
        <g data-testid={`shape-paint-${shape.id}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round">
          <ShapeFigure kind={shape.kind} w={w} h={h} sw={sw} />
        </g>
      </svg>

      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_PX}
          width={Math.max(w - SHAPE_LABEL_PADDING_WORLD * 2, 16)}
          undo={undo}
          // A shape's box is the size it was drawn: unlike a text object, it never grows
          // around its words, so there is nothing to do when the words change.
          onInput={() => {}}
          testId="text-editor"
          ariaLabel="Shape label"
          className="shape-label-editing"
          onEnd={onEndEdit}
        />
      ) : (
        <div data-testid={`shape-label-${shape.id}`} className="shape-label" style={labelStyle(w)}>
          {shape.label}
        </div>
      )}

      {showToolbar ? (
        // Counter-scaled by 1/zoom so the toolbar keeps a constant on-screen size while
        // the shape it belongs to scales with the board (shape.style).
        <div
          className="note-toolbar-scale"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transform: `scale(${1 / zoom})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <ShapeToolbar
            kind={shape.kind}
            fill={shape.fill}
            stroke={shape.stroke}
            onFill={paintFill}
            onStroke={paintStroke}
            onDelete={() => onDelete(shape.id)}
          />
        </div>
      ) : null}
    </div>
  );
}

/** The label box: centred in the shape, wrapping inside it, clipped by it (shape.label). */
function labelStyle(w: number): CSSProperties {
  return {
    position: 'absolute',
    inset: SHAPE_LABEL_PADDING_WORLD,
    width: Math.max(w - SHAPE_LABEL_PADDING_WORLD * 2, 16),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    fontSize: SHAPE_LABEL_FONT_PX,
    lineHeight: 1.25,
    color: '#1b1d23',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    overflow: 'hidden',
    pointerEvents: 'none',
  };
}
