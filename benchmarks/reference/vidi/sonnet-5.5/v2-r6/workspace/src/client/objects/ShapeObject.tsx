import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { ShapeSnapshot } from '../../shared/board-model';
import {
  SHAPE_FILL_COLORS, SHAPE_LABEL_FONT_PX, SHAPE_LABEL_MAX_CHARS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD,
} from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { useUndoController } from '../board/useUndo';
import type { ObjectProps } from './registry';
import { TextEditor } from './TextEditor';

const HALF = 2;
const KIND_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' } as const;
/** Share of the box kept free of text on each side, so a label stays inside the visible outline. */
const LABEL_INSET = { rect: 0.04, ellipse: 0.14, diamond: 0.2 } as const;

export function shapeName(shape: ShapeSnapshot): string {
  return shape.label === '' ? KIND_NAMES[shape.kind] : `${KIND_NAMES[shape.kind]}: ${shape.label}`;
}

function Outline({ shape }: { shape: ShapeSnapshot }) {
  const sw = SHAPE_STROKE_WIDTH_WORLD;
  const { width: w, height: h } = shape;
  const common = { fill: SHAPE_FILL_COLORS[shape.fill], stroke: SHAPE_STROKE_COLORS[shape.stroke], strokeWidth: sw, strokeLinejoin: 'round' as const };
  if (shape.kind === 'ellipse') {
    return <ellipse cx={w / HALF} cy={h / HALF} rx={Math.max(0, (w - sw) / HALF)} ry={Math.max(0, (h - sw) / HALF)} {...common} />;
  }
  if (shape.kind === 'diamond') {
    const pts = [[w / HALF, sw / HALF], [w - sw / HALF, h / HALF], [w / HALF, h - sw / HALF], [sw / HALF, h / HALF]];
    return <polygon points={pts.map((p) => p.join(',')).join(' ')} {...common} />;
  }
  return <rect x={sw / HALF} y={sw / HALF} width={Math.max(0, w - sw)} height={Math.max(0, h - sw)} {...common} />;
}

export function ShapeObject(props: ObjectProps) {
  const shape = props.object as ShapeSnapshot;
  const { doc, selected, editing, dragging, readOnly, onEndEdit } = props;
  const undo = useUndoController();
  const labelRef = useRef<HTMLDivElement>(null);
  const startEdit = () => { if (!readOnly) props.onStartEdit(shape.id); };

  // The textarea is as tall as its text so the label stays vertically centred while typing.
  useLayoutEffect(() => {
    const ta = labelRef.current?.querySelector('textarea');
    if (!ta) return;
    ta.style.height = '0';
    ta.style.height = `${ta.scrollHeight}px`;
  });

  const inset = LABEL_INSET[shape.kind];
  const labelStyle: CSSProperties = {
    fontSize: SHAPE_LABEL_FONT_PX,
    padding: `${shape.height * inset}px ${shape.width * inset + 4}px`,
  };
  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;

  return (
    <div
      className="shape-object"
      data-shape-object=""
      data-object-id={shape.id}
      data-note-id={shape.id}
      data-kind={shape.kind}
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={shapeName(shape)}
      tabIndex={0}
      style={{
        left: shape.x, top: shape.y, width: shape.width, height: shape.height, zIndex: shape.z,
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={(e) => props.onObjectPointerDown(e, shape.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEdit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget && !editing) {
          e.preventDefault();
          e.stopPropagation();
          startEdit();
        }
      }}
    >
      <svg className="shape-svg" width={shape.width} height={shape.height} viewBox={`0 0 ${shape.width} ${shape.height}`} aria-hidden="true">
        <Outline shape={shape} />
      </svg>
      <div ref={labelRef} className="shape-label" data-testid="shape-label" style={labelStyle}>
        {ytext ? (
          <TextEditor
            ytext={ytext}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={SHAPE_LABEL_FONT_PX}
            width="auto"
            label="Shape label"
            className="shape-editor"
            mergeFreshWithCreation
            onInput={() => {}}
            onEnd={onEndEdit}
            undo={undo}
          />
        ) : (
          <span className="shape-label-text">{shape.label}</span>
        )}
      </div>
    </div>
  );
}
