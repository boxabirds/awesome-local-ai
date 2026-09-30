import {
  useRef,
  useCallback,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import * as Y from 'yjs';
import type { ShapeSnap } from '@shared/objects/shape';
import { getShapeLabel } from '@shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '@shared/config';
import { TextEditor } from './TextEditor';
import type { UndoController } from '@client/board/undo';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

export function ShapeObject({
  shape,
  doc,
  zoom: _zoom,
  selected,
  editing,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undoController,
}: ShapeObjectProps): ReactElement {
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;
  const editableRef = useRef(editable);
  editableRef.current = editable;

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!editableRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      onStartEditRef.current(shape.id);
    },
    [shape.id],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const nativeEvent = e.nativeEvent as unknown as PointerEvent;
      onObjectPointerDown(nativeEvent, shape.id);
    },
    [shape.id, onObjectPointerDown],
  );

  const fillColor = SHAPE_FILL_COLORS[shape.fill] || 'transparent';
  const strokeColor = SHAPE_STROKE_COLORS[shape.stroke] || '#263238';
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;

  const labelYText = getShapeLabel(doc, shape.id);

  const renderShapeSvg = (): ReactElement => {
    const w = shape.width;
    const h = shape.height;
    const halfStroke = strokeWidth / 2;

    switch (shape.kind) {
      case 'rect':
        return (
          <rect
            x={halfStroke}
            y={halfStroke}
            width={w - strokeWidth}
            height={h - strokeWidth}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'ellipse':
        return (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={(w - strokeWidth) / 2}
            ry={(h - strokeWidth) / 2}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
      case 'diamond':
        return (
          <polygon
            points={`${w / 2},${halfStroke} ${w - halfStroke},${h / 2} ${w / 2},${h - halfStroke} ${halfStroke},${h / 2}`}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );
    }
  };

  return (
    <div
      role="group"
      aria-label={`Shape: ${shape.kind}${shape.label ? ' ' + shape.label : ''}`}
      className={`shape-object${selected ? ' shape-object--selected' : ''}`}
      data-selected={selected ? 'true' : 'false'}
      data-object-id={shape.id}
      data-testid={`shape-object-${shape.id}`}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        overflow: 'visible',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={shape.width}
        height={shape.height}
        style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
      >
        {renderShapeSvg()}
      </svg>
      {/* Label overlay */}
      {editing && labelYText && editable ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 8,
            overflow: 'hidden',
          }}
        >
          <TextEditor
            ytext={labelYText}
            maxChars={SHAPE_LABEL_MAX_CHARS}
            fontPx={14}
            width={shape.width - 16}
            onInput={() => {}}
            onEnd={onEndEdit}
            undoController={undoController}
          />
        </div>
      ) : (
        <div
          data-testid={`shape-label-${shape.id}`}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 8,
            fontSize: 14,
            fontFamily: 'Inter, system-ui, sans-serif',
            lineHeight: 1.3,
            wordBreak: 'break-word',
            overflow: 'hidden',
            pointerEvents: 'none',
            color: '#263238',
          }}
        >
          {shape.label}
        </div>
      )}
    </div>
  );
}
