/**
 * Story 10: ShapeObject — SVG shape rendering with centred label.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import {
  SHAPE_STROKE_WIDTH_WORLD, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS,
  SHAPE_LABEL_MAX_CHARS, type ShapeKind, type FillColor, type StrokeColor,
} from '@shared/config';
import { getShapeLabel } from '@shared/objects/shape';
import type { ObjectProps } from './registry';

export function ShapeObject(props: ObjectProps) {
  const { obj, doc, onObjectPointerDown, onStartEdit, onEndEdit, editing } = props;
  const shape = obj as any;
  const kind: ShapeKind = shape.kind ?? 'rect';
  const fill: FillColor = shape.fill ?? 'white';
  const stroke: StrokeColor = shape.stroke ?? 'dark';
  const label: string = shape.label ?? '';

  const x = obj.x;
  const y = obj.y;
  const w = obj.width;
  const h = obj.height;

  const fillVal = SHAPE_FILL_COLORS[fill] ?? '#FFFFFF';
  const strokeVal = SHAPE_STROKE_COLORS[stroke] ?? '#263238';

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(obj.id);
  }, [obj.id, onStartEdit]);

  let shapeEl: React.ReactNode;
  const strokeW = SHAPE_STROKE_WIDTH_WORLD;

  if (kind === 'rect') {
    shapeEl = (
      <rect
        x={x} y={y} width={w} height={h}
        fill={fillVal} stroke={strokeVal} strokeWidth={strokeW}
        rx={2} ry={2}
      />
    );
  } else if (kind === 'ellipse') {
    shapeEl = (
      <ellipse
        cx={x + w / 2} cy={y + h / 2}
        rx={w / 2} ry={h / 2}
        fill={fillVal} stroke={strokeVal} strokeWidth={strokeW}
      />
    );
  } else {
    const points = [
      `${x + w / 2},${y}`,
      `${x + w},${y + h / 2}`,
      `${x + w / 2},${y + h}`,
      `${x},${y + h / 2}`,
    ].join(' ');
    shapeEl = (
      <polygon
        points={points}
        fill={fillVal} stroke={strokeVal} strokeWidth={strokeW}
      />
    );
  }

  return (
    <g
      data-testid="shape-object"
      data-shape-id={obj.id}
      onPointerDown={(e) => onObjectPointerDown(e, obj.id)}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: 'move' }}
    >
      {shapeEl}
      {editing ? (
        <foreignObject x={x} y={y} width={w} height={h} style={{ pointerEvents: 'none' }}>
          <ShapeLabelEditor
            doc={doc}
            id={obj.id}
            onEndEdit={onEndEdit}
          />
        </foreignObject>
      ) : label ? (
        <foreignObject x={x} y={y} width={w} height={h} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              overflow: 'hidden',
              fontSize: 14,
              fontFamily: 'Inter, system-ui, sans-serif',
              color: '#263238',
              wordWrap: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            {label}
          </div>
        </foreignObject>
      ) : null}
    </g>
  );
}

function ShapeLabelEditor({
  doc, id, onEndEdit,
}: {
  doc: Y.Doc; id: string;
  onEndEdit: (next: 'selected' | 'unselected') => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    const label = getShapeLabel(doc, id);
    if (!label) return;
    setText(label.toString());
    const handler = () => setText(label.toString());
    label.observe(handler);
    return () => { label.unobserve(handler); };
  }, [doc, id]);

  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, []);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const clamped = val.slice(0, SHAPE_LABEL_MAX_CHARS);
    setText(clamped);
    const label = getShapeLabel(doc, id);
    if (label) {
      doc.transact(() => {
        label.delete(0, label.length);
        if (clamped) label.insert(0, clamped);
      });
    }
  }, [doc, id]);

  const handleBlur = useCallback(() => {
    onEndEdit('selected');
  }, [onEndEdit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
    }
    e.stopPropagation();
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <textarea
        ref={ref}
        data-testid="shape-label-editor"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={{
          width: '90%',
          height: '80%',
          textAlign: 'center',
          fontSize: 14,
          fontFamily: 'Inter, system-ui, sans-serif',
          border: '1px solid #ccc',
          outline: 'none',
          resize: 'none',
          padding: 4,
        }}
      />
    </div>
  );
}
