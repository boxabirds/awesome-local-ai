import { objectBounds } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from '../../shared/config';
import type { ShapeKind } from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import type { ShapeSnap } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

const HALF = 2;
const KIND_NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' };
/** Share of the width kept free on each side of the label so text stays inside the outline. */
const LABEL_INSET: Record<ShapeKind, number> = { rect: 0.04, ellipse: 0.14, diamond: 0.25 };
const LABEL_PADDING_WORLD = 6;

export function shapeAriaLabel(kind: ShapeKind, label: string): string {
  return label ? `${KIND_NAMES[kind]}: ${label}` : KIND_NAMES[kind];
}

export function ShapeObject(props: ObjectProps) {
  const { doc, selected, editing } = props;
  const shape = props.object as ShapeSnap;
  const { width, height } = objectBounds(shape);
  const undo = useUndoController();
  const ytext = editing && !props.readOnly ? getShapeLabel(doc, shape.id) : undefined;
  const fill = SHAPE_FILL_COLORS[shape.fill];
  const stroke = SHAPE_STROKE_COLORS[shape.stroke];
  const inset = SHAPE_STROKE_WIDTH_WORLD / HALF;
  const insetX = width * LABEL_INSET[shape.kind];
  const insetY = height * (LABEL_INSET[shape.kind] / HALF);

  const outline = {
    fill,
    stroke,
    strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    strokeLinejoin: 'round' as const,
  };

  return (
    <div
      role="group"
      aria-label={shapeAriaLabel(shape.kind, shape.label ?? '')}
      data-shape-object=""
      data-shape-kind={shape.kind}
      data-note-id={shape.id}
      data-selected={selected ? 'true' : 'false'}
      tabIndex={0}
      className={`shape-object${selected ? ' shape-object--selected' : ''}`}
      style={{ left: shape.x, top: shape.y, width, height, zIndex: shape.z, cursor: editing ? 'text' : 'pointer' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.button !== 0 || editing) return;
        props.onObjectPointerDown(e, shape.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!props.readOnly) props.onStartEdit(shape.id);
      }}
    >
      <svg className="shape-outline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {shape.kind === 'rect' && (
          <rect x={inset} y={inset} width={Math.max(0, width - SHAPE_STROKE_WIDTH_WORLD)} height={Math.max(0, height - SHAPE_STROKE_WIDTH_WORLD)} {...outline} />
        )}
        {shape.kind === 'ellipse' && (
          <ellipse
            cx={width / HALF}
            cy={height / HALF}
            rx={Math.max(0, width / HALF - inset)}
            ry={Math.max(0, height / HALF - inset)}
            {...outline}
          />
        )}
        {shape.kind === 'diamond' && (
          <polygon
            points={`${width / HALF},${inset} ${width - inset},${height / HALF} ${width / HALF},${height - inset} ${inset},${height / HALF}`}
            {...outline}
          />
        )}
      </svg>
      <div
        className="shape-label"
        data-testid="shape-label"
        style={{
          padding: `${LABEL_PADDING_WORLD}px ${insetX + LABEL_PADDING_WORLD}px`,
          paddingTop: insetY + LABEL_PADDING_WORLD,
          paddingBottom: insetY + LABEL_PADDING_WORLD,
          fontSize: SHAPE_LABEL_FONT_PX,
          lineHeight: TEXT_LINE_HEIGHT,
          fontFamily: TEXT_FONT_FAMILY,
        }}
      >
        {ytext ? (
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_PX}
            width="auto"
            onInput={() => {}}
            onEnd={(next) => props.onEndEdit(next)}
            undo={undo}
            className="shape-label-editor"
            ariaLabel="Shape label"
            containerSelector="[data-shape-object]"
            style={{ fontFamily: TEXT_FONT_FAMILY, lineHeight: TEXT_LINE_HEIGHT }}
          />
        ) : (
          <span className="shape-label-text">{shape.label}</span>
        )}
      </div>
    </div>
  );
}
