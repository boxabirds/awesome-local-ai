import type { JSX } from 'react';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import { getShapeLabel, type ShapeSnap } from '../../shared/objects/shape';
import { TextEditor } from './TextEditor';
import type { ObjectProps } from './registry';

export function ShapeObjectComponent(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, editable, onPointerDown, onStartEdit, onEndEdit, undo } = props;
  const shape = obj as ShapeSnap;
  const { x, y, width, height, kind, fill, stroke, label } = shape;

  const fillValue = SHAPE_FILL_COLORS[fill] ?? SHAPE_FILL_COLORS.white;
  const strokeValue = SHAPE_STROKE_COLORS[stroke] ?? SHAPE_STROKE_COLORS.dark;
  const ytext = getShapeLabel(doc, shape.id);

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    onStartEdit(shape.id);
  };

  // Render the shape SVG
  const renderShape = () => {
    const common = {
      fill: fillValue,
      stroke: strokeValue,
      strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    };

    switch (kind) {
      case 'rect':
        return <rect x={0} y={0} width={width} height={height} rx={2} {...common} />;
      case 'ellipse':
        return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />;
      case 'diamond': {
        const points = [
          `${width / 2},0`,
          `${width},${height / 2}`,
          `${width / 2},${height}`,
          `0,${height / 2}`,
        ].join(' ');
        return <polygon points={points} {...common} />;
      }
      default:
        return <rect x={0} y={0} width={width} height={height} {...common} />;
    }
  };

  return (
    <div
      role="group"
      aria-label={label ? `Shape: ${label}` : 'Shape'}
      data-testid="shape-object"
      data-selected={selected || undefined}
      data-note-id={shape.id}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height,
        outline: selected ? '2px solid #2196F3' : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : 'grab',
      }}
      onPointerDown={(e) => {
        if (editing) return;
        if (!editable) {
          e.stopPropagation();
          return;
        }
        onPointerDown(e, shape.id);
      }}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {renderShape()}
        {editing && ytext ? (
          <foreignObject x={0} y={0} width={width} height={height}>
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TextEditor
                ytext={ytext}
                maxChars={SHAPE_LABEL_MAX_CHARS}
                fontPx={16}
                width="auto"
                onInput={() => {}}
                onEnd={() => {
                  onEndEdit();
                  undo?.boundary();
                }}
                undo={undo}
                padding={8}
                paddingVertical={8}
                dataTestId="shape-label-editor"
              />
            </div>
          </foreignObject>
        ) : (
          <text
            x={width / 2}
            y={height / 2}
            textAnchor="middle"
            dominantBaseline="central"
            style={{
              fontSize: 16,
              fontFamily: 'system-ui, sans-serif',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {label ? (
              label.split('\n').map((line, i) => (
                <tspan key={i} x={width / 2} dy={i === 0 ? 0 : 1.2}>
                  {line}
                </tspan>
              ))
            ) : null}
          </text>
        )}
      </svg>
    </div>
  );
}
