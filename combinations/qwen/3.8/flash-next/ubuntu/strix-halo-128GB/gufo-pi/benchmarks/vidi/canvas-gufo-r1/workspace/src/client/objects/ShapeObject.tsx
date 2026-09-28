import { useCallback, useRef } from 'react';
import type * as Y from 'yjs';
import type { ShapeObjectSnapshot } from '../../shared/board-model';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface ShapeObjectProps {
  shape: ShapeObjectSnapshot;
  doc: Y.Doc;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  zoom: number;
  onSelect(id: string): void;
  onToggleSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  onObjectPointerDown?(e: PointerEvent, id: string): void;
  undoController?: { boundary(): void };
}

export function ShapeObject(props: ShapeObjectProps) {
  const {
    shape, doc, editing, editable,
    onSelect, onToggleSelect, onStartEdit, onEndEdit,
    onObjectPointerDown, undoController,
  } = props;

  const fill = SHAPE_FILL_COLORS[shape.fill] || 'transparent';
  const stroke = SHAPE_STROKE_COLORS[shape.stroke] || '#263238';
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      onToggleSelect(shape.id);
    } else {
      onSelect(shape.id);
    }
    if (onObjectPointerDown && !editing) {
      onObjectPointerDown(e.nativeEvent as any, shape.id);
    }
  }, [shape.id, editing, onSelect, onToggleSelect, onObjectPointerDown]);

  const handleDblClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!editable) return;
    onStartEdit(shape.id);
  }, [shape.id, editable, onStartEdit]);

  // Compute diamond points
  const diamondPoints = `${shape.width / 2},0 ${shape.width},${shape.height / 2} ${shape.width / 2},${shape.height} 0,${shape.height / 2}`;

  return (
    <div
      data-testid={`shape-${shape.id}`}
      data-shape-kind={shape.kind}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        cursor: editing ? 'text' : 'move',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
    >
      <svg
        width={shape.width}
        height={shape.height}
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        {shape.kind === 'rect' && (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={shape.width - strokeWidth}
            height={shape.height - strokeWidth}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            rx={2}
          />
        )}
        {shape.kind === 'ellipse' && (
          <ellipse
            cx={shape.width / 2}
            cy={shape.height / 2}
            rx={(shape.width - strokeWidth) / 2}
            ry={(shape.height - strokeWidth) / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
        {shape.kind === 'diamond' && (
          <polygon
            points={diamondPoints}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        )}
      </svg>
      {/* Label */}
      {editing ? (
        <ShapeLabelEditor
          shape={shape}
          doc={doc}
          onEndEdit={onEndEdit}
          undoController={undoController}
        />
      ) : shape.label ? (
        <div
          style={{
            position: 'absolute',
            inset: strokeWidth + 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            overflow: 'hidden',
            wordBreak: 'break-word',
            fontSize: 14,
            color: '#263238',
            pointerEvents: 'none',
          }}
          data-testid={`shape-label-${shape.id}`}
        >
          {shape.label}
        </div>
      ) : null}
    </div>
  );
}

function ShapeLabelEditor(props: {
  shape: ShapeObjectSnapshot;
  doc: Y.Doc;
  onEndEdit(): void;
  undoController?: { boundary(): void };
}) {
  const { shape, doc, onEndEdit, undoController } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const label = getShapeLabel(doc, shape.id);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!label) return;
    let text = e.target.value;
    if (text.length > SHAPE_LABEL_MAX_CHARS) {
      text = text.slice(0, SHAPE_LABEL_MAX_CHARS);
    }
    doc.transact(() => {
      label.delete(0, label.length);
      if (text.length > 0) label.insert(0, text);
    }, LOCAL_ORIGIN);
  }, [label, doc]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      undoController?.boundary();
      onEndEdit();
    }
  }, [onEndEdit, undoController]);

  const handleBlur = useCallback(() => {
    undoController?.boundary();
    onEndEdit();
  }, [onEndEdit, undoController]);

  return (
    <textarea
      ref={textareaRef}
      autoFocus
      value={shape.label}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      data-testid={`shape-editor-${shape.id}`}
      style={{
        position: 'absolute',
        inset: 4,
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        textAlign: 'center',
        fontSize: 14,
        color: '#263238',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  );
}
