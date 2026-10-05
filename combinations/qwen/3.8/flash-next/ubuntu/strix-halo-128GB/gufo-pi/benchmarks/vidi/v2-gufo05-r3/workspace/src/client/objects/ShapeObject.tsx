/**
 * Shape objects: rectangle, ellipse and diamond, with a label and two colours
 * (story 10, `shape.create`, `shape.label`, `shape.style`).
 *
 * The box is the object's stored `x, y, width, height` in world coordinates, and the
 * drawing is an SVG measured in those same world units: the viewport's world layer is
 * already scaled by the zoom, so resizing a shape scales the drawing *and* the label
 * inside it (`shape.resize`) — which is what keeps a diamond's points on the box's
 * edges and an ellipse's curve round at any size.
 *
 * The label is a `Y.Text`, so two people typing in the same shape merge per caret as
 * they do on a note. It is centred in the box and wraps; a label longer than the box
 * overflows rather than being clipped into unreadable slivers, because the person who
 * typed it needs to see what they typed.
 */
import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import { objectBounds, type ObjectSnapshot } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_MIN_SIZE_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  type ShapeKind,
} from '../../shared/config';
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import { hitTestBounds, type ObjectTypeSpec } from './registry';
import type { EndEditTarget } from '../board/useSelection';

/** The label's ink: the same dark as a shape's default outline. */
const LABEL_INK = '#263238';

/** Breathing room between the box edge and the label, in world units. */
const LABEL_PADDING_WORLD = 10;

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  selected: boolean;
  editing: boolean;
  /** Finish editing: back to selected, or out of the selection entirely. */
  onEndEdit(next?: EndEditTarget): void;
  /** Start editing the label. */
  onRequestEdit(): void;
  onObjectPointerDown(event: ReactPointerEvent, snapshot: ObjectSnapshot): void;
}

export function ShapeObject(props: ShapeObjectProps) {
  const { shape, doc, selected, editing, onEndEdit, onRequestEdit, onObjectPointerDown } = props;
  // The label is looked up per snapshot rather than once on mount: reading a `Y.Text`
  // that has not been created yet would otherwise leave this editor bound to nothing
  // when the shape arrives from another screen.
  const ytext = useMemo(() => getShapeLabel(doc, shape.id), [doc, shape]);
  // The box comes from the model rather than from the snapshot's optional fields:
  // a shape made before its size was stored still has one.
  const box = objectBounds(shape);
  const fill = shape.fill === 'none' ? 'transparent' : SHAPE_FILL_COLORS[shape.fill];
  const stroke = SHAPE_STROKE_COLORS[shape.stroke];

  return (
    <div
      className="board-object shape-object"
      data-object-id={shape.id}
      data-object-type="shape"
      data-shape-kind={shape.kind}
      data-selected={selected ? 'true' : 'false'}
      style={{
        position: 'absolute',
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        // The world layer lets nothing through; an object takes its own clicks back.
        pointerEvents: 'auto',
        zIndex: shape.z,
      }}
      onDoubleClick={(event) => {
        // A double-click means the label — never a zoom, and never a drag of the
        // shape by its body a second time.
        event.stopPropagation();
        event.preventDefault();
        onRequestEdit();
      }}
    >
      <svg
        className="shape-svg"
        data-object-body=""
        data-testid={`shape-body-${shape.id}`}
        width={box.width}
        height={box.height}
        style={{ position: 'absolute', left: 0, top: 0, display: 'block', overflow: 'visible' }}
        onPointerDown={(event) => onObjectPointerDown(event, shape)}
      >
        <ShapePath kind={shape.kind} width={box.width} height={box.height} fill={fill} stroke={stroke} />
      </svg>

      {editing && ytext ? (
        <div
          className="shape-label-editor"
          style={{
            position: 'absolute',
            left: `${LABEL_PADDING_WORLD}px`,
            top: 0,
            height: `${box.height}px`,
            width: `${Math.max(box.width - LABEL_PADDING_WORLD * 2, 8)}px`,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_PX}
            width="auto"
            ariaLabel="Shape label"
            onEnd={(next) => onEndEdit(next)}
          />
        </div>
      ) : (
        <div
          className="shape-label"
          data-testid={`shape-label-${shape.id}`}
          data-empty={shape.label.length === 0 ? 'true' : 'false'}
          style={{
            position: 'absolute',
            inset: `${LABEL_PADDING_WORLD}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            color: LABEL_INK,
            fontSize: `${SHAPE_LABEL_FONT_PX}px`,
            lineHeight: 1.3,
            wordBreak: 'break-word',
            overflow: 'hidden',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {shape.label}
        </div>
      )}
    </div>
  );
}

/**
 * The three drawings, each pulled in by half the stroke width so the outline stays
 * inside the box: what a shape covers is its rectangle, and a hit test on that
 * rectangle is then honest at the edges.
 */
export function ShapePath(props: {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}) {
  const { kind, width, height, fill, stroke } = props;
  const inset = SHAPE_STROKE_WIDTH_WORLD / 2;
  const w = Math.max(width - SHAPE_STROKE_WIDTH_WORLD, 1);
  const h = Math.max(height - SHAPE_STROKE_WIDTH_WORLD, 1);
  const paint = { fill, stroke, strokeWidth: SHAPE_STROKE_WIDTH_WORLD } as const;
  if (kind === 'ellipse') {
    return (
      <ellipse
        cx={width / 2}
        cy={height / 2}
        rx={w / 2}
        ry={h / 2}
        transform={`translate(${inset}, ${inset})`}
        {...paint}
      />
    );
  }
  if (kind === 'diamond') {
    const points = [
      `${width / 2},${inset}`,
      `${width - inset},${height / 2}`,
      `${width / 2},${height - inset}`,
      `${inset},${height / 2}`,
    ].join(' ');
    return <polygon points={points} {...paint} />;
  }
  return <rect x={inset} y={inset} width={w} height={h} {...paint} />;
}

export const shapeObjectType: ObjectTypeSpec = {
  Component: function ShapeType(props) {
    const { doc, snapshot, selection, onEditChange, onObjectPointerDown } = props;
    return (
      <ShapeObject
        shape={snapshot as ShapeSnap}
        doc={doc}
        selected={selection.selected}
        editing={selection.editing}
        onRequestEdit={() => onEditChange(snapshot.id, null)}
        onEndEdit={(next) => onEditChange(snapshot.id, next ?? 'selected')}
        onObjectPointerDown={onObjectPointerDown}
      />
    );
  },
  resizable: true,
  aspectLocked: false,
  editableText: true,
  minSize: SHAPE_MIN_SIZE_WORLD,
  // The rectangle, the ellipse included: the box is what selects, moves and resizes,
  // and the four side anchors an arrow uses live on that box.
  hitTest: hitTestBounds,
};
