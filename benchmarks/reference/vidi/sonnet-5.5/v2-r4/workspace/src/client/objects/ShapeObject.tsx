import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  SHAPE_FILL_COLORS,
  SHAPE_LABEL_FONT_PX,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_LABEL_PADDING_WORLD,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  TEXT_FONT_FAMILY,
} from '../../shared/config';
import { getShapeLabel, type ShapeKind, type ShapeSnap } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

const KIND_NAMES: Record<ShapeKind, string> = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' };
const LINE_HEIGHT = 1.25;
/** Share of the width and height left to the label; an ellipse and a diamond have less room than a rectangle. */
const LABEL_INSET: Record<ShapeKind, number> = { rect: 0, ellipse: 0.14, diamond: 0.2 };

export function shapeAriaLabel(kind: ShapeKind, label: string): string {
  return label === '' ? KIND_NAMES[kind] : `${KIND_NAMES[kind]}: ${label}`;
}

export function ShapeObject(props: ObjectProps) {
  const { doc, selected, editing, editable } = props;
  const shape = props.object as ShapeSnap;
  const undo = useUndoController();
  const { width: w, height: h } = shape;
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const common = { fill: SHAPE_FILL_COLORS[shape.fill], stroke: SHAPE_STROKE_COLORS[shape.stroke], strokeWidth: sw, strokeLinejoin: 'round' as const };

  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;
  const inset = LABEL_INSET[shape.kind];
  const padX = SHAPE_LABEL_PADDING_WORLD + w * inset;
  const padY = SHAPE_LABEL_PADDING_WORLD + h * inset;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || editing) return;
    e.stopPropagation();
    props.onObjectPointerDown(e, shape.id);
  };

  return (
    <div
      role="group"
      aria-label={shapeAriaLabel(shape.kind, shape.label)}
      tabIndex={0}
      data-selected={selected ? 'true' : 'false'}
      data-object-id={shape.id}
      data-shape-id={shape.id}
      data-shape-kind={shape.kind}
      data-z={shape.z}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) props.onStartEdit(shape.id);
      }}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: w,
        height: h,
        zIndex: shape.z,
        boxSizing: 'border-box',
        outline: 'none',
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
      }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} aria-hidden="true">
        {shape.kind === 'rect' && <rect x={sw / 2} y={sw / 2} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...common} />}
        {shape.kind === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, (w - sw) / 2)} ry={Math.max(0, (h - sw) / 2)} {...common} />}
        {shape.kind === 'diamond' && (
          <polygon points={`${w / 2},${sw / 2} ${w - sw / 2},${h / 2} ${w / 2},${h - sw / 2} ${sw / 2},${h / 2}`} {...common} />
        )}
      </svg>
      <div
        data-testid="shape-label"
        style={{
          position: 'absolute',
          inset: 0,
          boxSizing: 'border-box',
          padding: `${padY}px ${padX}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontFamily: TEXT_FONT_FAMILY,
          fontSize: SHAPE_LABEL_FONT_PX,
          lineHeight: LINE_HEIGHT,
          color: '#222',
          overflow: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {ytext ? (
          <div style={{ width: '100%', pointerEvents: 'auto', maxHeight: '100%' }}>
            <TextEditor
              ytext={ytext}
              maxChars={SHAPE_LABEL_MAX_CHARS}
              fontPx={SHAPE_LABEL_FONT_PX}
              width="auto"
              onInput={() => {}}
              onEnd={props.onEndEdit}
              undo={undo}
              ariaLabel="Shape label"
              lineHeight={LINE_HEIGHT}
              textAlign="center"
              fontFamily={TEXT_FONT_FAMILY}
            />
          </div>
        ) : (
          <div style={{ width: '100%', maxHeight: '100%', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shape.label}</div>
        )}
      </div>
    </div>
  );
}
