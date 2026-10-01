import { objectBounds } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD, TEXT_FONT_FAMILY,
} from '../../shared/config';
import { getShapeLabel, type ShapeKind, type ShapeSnap } from '../../shared/objects/shape';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

const PRIMARY_BUTTON = 0;
const LABEL_FONT_PX = 16;
const KIND_NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' };

function outline(kind: ShapeKind, w: number, h: number, inset: number) {
  if (kind === 'ellipse') {
    return { tag: 'ellipse' as const, props: { cx: w / 2, cy: h / 2, rx: Math.max(0, w / 2 - inset), ry: Math.max(0, h / 2 - inset) } };
  }
  if (kind === 'diamond') {
    const pts = [[w / 2, inset], [w - inset, h / 2], [w / 2, h - inset], [inset, h / 2]];
    return { tag: 'polygon' as const, props: { points: pts.map((p) => p.join(',')).join(' ') } };
  }
  return { tag: 'rect' as const, props: { x: inset, y: inset, width: Math.max(0, w - 2 * inset), height: Math.max(0, h - 2 * inset) } };
}

export function ShapeObject(props: ObjectProps) {
  const { selected, editing, dragging, readOnly } = props;
  const shape = props.object as ShapeSnap;
  const { id } = shape;
  const { width, height } = objectBounds({ ...shape, width: shape.width ?? 1, height: shape.height ?? 1 });
  const shapeOutline = outline(shape.kind, width, height, SHAPE_STROKE_WIDTH_WORLD / 2);
  const paint = {
    fill: SHAPE_FILL_COLORS[shape.fill], stroke: SHAPE_STROKE_COLORS[shape.stroke], strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    strokeLinejoin: 'round' as const,
  };
  const kindName = KIND_NAMES[shape.kind];

  return (
    <div
      role="group"
      aria-label={shape.label === '' ? kindName : `${kindName}: ${shape.label}`}
      tabIndex={0}
      data-shape=""
      data-id={id}
      data-kind={shape.kind}
      data-x={shape.x}
      data-y={shape.y}
      data-width={width}
      data-height={height}
      data-fill={shape.fill}
      data-stroke={shape.stroke}
      data-selected={selected}
      data-editing={editing}
      data-dragging={dragging}
      className="shape-object"
      style={{
        left: shape.x, top: shape.y, zIndex: shape.z, width, height,
        cursor: dragging ? 'grabbing' : editing ? 'text' : 'pointer',
      }}
      onPointerDown={(e) => {
        if (editing || (e.button ?? PRIMARY_BUTTON) !== PRIMARY_BUTTON) return;
        e.stopPropagation();
        props.onPointerDown(e, id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!readOnly) props.onStartEdit(id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing && !readOnly) {
          e.preventDefault();
          e.stopPropagation();
          props.onStartEdit(id);
        }
      }}
    >
      <svg className="shape-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {shapeOutline.tag === 'rect' && <rect {...shapeOutline.props} {...paint} />}
        {shapeOutline.tag === 'ellipse' && <ellipse {...shapeOutline.props} {...paint} />}
        {shapeOutline.tag === 'polygon' && <polygon {...shapeOutline.props} {...paint} />}
      </svg>
      <div
        className="shape-label"
        data-testid="shape-label"
        style={{ fontFamily: TEXT_FONT_FAMILY, fontSize: LABEL_FONT_PX }}
      >
        <div className="shape-label-grid">
          <div className="shape-label-text">{shape.label}{editing ? '​' : ''}</div>
          {editing && !readOnly && <ShapeLabelEditor {...props} />}
        </div>
      </div>
    </div>
  );
}

function ShapeLabelEditor(props: ObjectProps) {
  const ytext = getShapeLabel(props.doc, props.object.id);
  if (!ytext) return null; // deleted while editing: no write, no re-creation
  return (
    <TextEditor
      ytext={ytext}
      maxChars={SHAPE_LABEL_MAX_CHARS}
      fontPx={LABEL_FONT_PX}
      width="auto"
      className="shape-editor"
      ariaLabel="Shape label"
      boundaryOnStart={ytext.length > 0}
      onInput={() => {}}
      onEnd={props.onEndEdit}
      undo={props.undo}
    />
  );
}
