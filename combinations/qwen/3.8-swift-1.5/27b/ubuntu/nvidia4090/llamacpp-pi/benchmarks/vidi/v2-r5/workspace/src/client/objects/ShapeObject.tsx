// src/client/objects/ShapeObject.tsx
// SVG shape rendering with centred wrapping label.

import { useCallback } from 'react';
import type { ReactElement, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import * as Y from 'yjs';
import { SHAPE_STROKE_WIDTH_WORLD, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';
import type { ShapeSnap } from '../../shared/objects/shape';

export interface ShapeObjectProps {
  obj: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
  onDblClick: (e: ReactMouseEvent, id: string) => void;
  onEndEdit: (next: 'selected' | 'unselected') => void;
  undo?: { boundary(): void };
}

export function ShapeObject(props: ShapeObjectProps): ReactElement {
  const { obj, zoom, selected, editing, onPointerDown, onDblClick, onEndEdit, undo } = props;
  const { x, y, width, height, kind, fill, stroke, label } = obj;

  const fillColor = SHAPE_FILL_COLORS[fill as FillColor] ?? 'transparent';
  const strokeColor = SHAPE_STROKE_COLORS[stroke as StrokeColor] ?? '#263238';

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    onPointerDown(e, obj.id);
  }, [obj.id, onPointerDown]);

  const handleDblClick = useCallback((e: ReactMouseEvent) => {
    e.stopPropagation();
    onDblClick(e, obj.id);
  }, [obj.id, onDblClick]);

  // Render the shape SVG element
  const renderShape = () => {
    const common = {
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    };

    switch (kind) {
      case 'rect':
        return <rect x={0} y={0} width={width} height={height} rx={2} {...common} />;
      case 'ellipse':
        return <ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} {...common} />;
      case 'diamond': {
        const points = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
        return <polygon points={points} {...common} />;
      }
      default:
        return <rect x={0} y={0} width={width} height={height} {...common} />;
    }
  };

  return (
    <g
      data-testid="shape-object"
      role="group"
      aria-label={`Shape: ${kind}${label ? `: ${label}` : ''}`}
      transform={`translate(${x}, ${y})`}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
      style={{ cursor: 'move' }}
    >
      {renderShape()}

      {/* Label */}
      {label && !editing && (
        <foreignObject x={0} y={0} width={width} height={height} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontSize: 14,
              fontFamily: 'Inter, system-ui, sans-serif',
              color: '#263238',
              overflow: 'hidden',
              wordWrap: 'break-word',
              padding: 4,
            }}
          >
            {label}
          </div>
        </foreignObject>
      )}

      {/* Editing label */}
      {editing && (
        <foreignObject x={0} y={0} width={width} height={height}>
          <textarea
            data-testid="shape-label-editor"
            autoFocus
            defaultValue={label}
            maxLength={SHAPE_LABEL_MAX_CHARS}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              fontSize: 14,
              fontFamily: 'Inter, system-ui, sans-serif',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              resize: 'none',
              padding: 4,
            }}
            onBlur={(e) => {
              const text = e.target.value.slice(0, SHAPE_LABEL_MAX_CHARS);
              const objects = props.doc.getMap('objects');
              const objMap = objects.get(obj.id) as Y.Map<unknown> | undefined;
              if (objMap) {
                const ytext = objMap.get('label') as Y.Text | undefined;
                if (ytext) {
                  undo?.boundary();
                  props.doc.transact(() => {
                    ytext.delete(0, ytext.length);
                    if (text) ytext.insert(0, text);
                  }, Symbol('LOCAL_ORIGIN') as any);
                  undo?.boundary();
                }
              }
              onEndEdit('selected');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
          />
        </foreignObject>
      )}

      {/* Selection outline */}
      {selected && (
        <rect
          x={-2}
          y={-2}
          width={width + 4}
          height={height + 4}
          fill="none"
          stroke="#1E88E5"
          strokeWidth={2 / zoom}
          strokeDasharray="4 2"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}
