import type { JSX } from 'react';
import { objectBounds } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  type ShapeKind
} from '../../shared/config';
import { getShapeFields, getShapeLabel } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

export type ShapeObjectProps = ObjectProps;

const KIND_LABEL: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond'
};

const SHAPE_LABEL_FONT_PX = 16;

// Shape kind geometry, drawn inside a bounds.width x bounds.height box,
// inset by half the stroke so the stroke stays fully visible.
function renderGeometry(
  kind: ShapeKind,
  w: number,
  h: number,
  sw: number,
  fill: string,
  stroke: string
): JSX.Element {
  const x = sw / 2;
  const y = sw / 2;
  const iw = Math.max(0, w - sw);
  const ih = Math.max(0, h - sw);
  const common = { fill, stroke, strokeWidth: sw } as const;
  if (kind === 'ellipse') {
    return <ellipse cx={w / 2} cy={h / 2} rx={iw / 2} ry={ih / 2} {...common} />;
  }
  if (kind === 'diamond') {
    const points = `${w / 2},${y} ${x + iw},${h / 2} ${w / 2},${y + ih} ${x},${h / 2}`;
    return <polygon points={points} {...common} />;
  }
  return <rect x={x} y={y} width={iw} height={ih} {...common} />;
}

// Rectangle / ellipse / diamond with a centred Y.Text label. Selection, move,
// resize, delete and undo are generic (registry); the label editor is the
// shared story 2 TextEditor so concurrent typing merges identically.
export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const {
    obj,
    doc,
    selected,
    editing,
    editable = true,
    onObjectPointerDown,
    onStartEdit,
    onEndEdit,
    undo
  } = props;
  const fields = getShapeFields(doc, obj.id);
  const bounds = objectBounds(obj);
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const kind = fields?.kind ?? 'rect';
  const fill = fields !== undefined ? SHAPE_FILL_COLORS[fields.fill] : '#ffffff';
  const stroke = fields !== undefined ? SHAPE_STROKE_COLORS[fields.stroke] : '#263238';
  const label = fields?.label ?? '';

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editable) return;
    if (editing) return;
    onObjectPointerDown(e, obj.id);
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!editable) return;
    if (!editing) onStartEdit(obj.id);
  };

  const ytext = editing ? getShapeLabel(doc, obj.id) : undefined;
  const showEditor = editing && ytext !== undefined;

  return (
    <div
      data-testid="shape-object"
      data-id={obj.id}
      data-kind={kind}
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label={label === '' ? KIND_LABEL[kind] : `${KIND_LABEL[kind]} ${label}`}
      tabIndex={0}
      className="shape-object"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <svg
        className="shape-svg"
        width={bounds.width}
        height={bounds.height}
        viewBox={`0 0 ${bounds.width} ${bounds.height}`}
        aria-hidden="true"
      >
        {renderGeometry(kind, bounds.width, bounds.height, sw, fill, stroke)}
      </svg>
      {showEditor ? (
        <TextEditor
          ytext={ytext}
          maxChars={SHAPE_LABEL_MAX_CHARS}
          fontPx={SHAPE_LABEL_FONT_PX}
          width="auto"
          onEnd={onEndEdit}
          undo={undo}
          testId="shape-label-editor"
          className="shape-label-editor"
        />
      ) : (
        <div
          className="shape-label"
          style={{
            fontFamily: TEXT_FONT_FAMILY,
            fontSize: SHAPE_LABEL_FONT_PX,
            lineHeight: '1.3',
            color: '#0f172a'
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
