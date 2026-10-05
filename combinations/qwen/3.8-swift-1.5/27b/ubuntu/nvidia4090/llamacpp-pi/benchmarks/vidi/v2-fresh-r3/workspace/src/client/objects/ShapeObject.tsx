import { useEffect, useRef, type JSX } from 'react';
import { SHAPE_STROKE_WIDTH_WORLD, SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import { getShapeLabel } from '../../shared/objects/shape';
import { ToolContext } from '../board/useTool';
import { useContext } from 'react';
import type { ObjectProps } from './registry';

const SELECTION_OUTLINE = '2px solid #1A73E8';

/**
 * One shape object in the world layer (story 10). Renders SVG rect/ellipse/
 * polygon with fill/stroke colours and a centred wrapping label. Double-click
 * starts label editing.
 */
export function ShapeObject(props: ObjectProps): JSX.Element {
  const { obj, doc, selected, editing, dragging, onObjectPointerDown, onStartEdit, onEndEdit } = props;
  const tool = useContext(ToolContext);

  const width = obj.width ?? 160;
  const height = obj.height ?? 160;
  const kind = (obj.kind ?? 'rect') as 'rect' | 'ellipse' | 'diamond';
  const fillKey = (obj.fill ?? 'white') as string;
  const strokeKey = (obj.stroke ?? 'dark') as string;
  const fill = (SHAPE_FILL_COLORS as Record<string, string>)[fillKey] ?? 'transparent';
  const stroke = (SHAPE_STROKE_COLORS as Record<string, string>)[strokeKey] ?? '#263238';
  const label = obj.text ?? '';

  const labelRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (editing) return;
    e.stopPropagation();
    e.preventDefault();
    onObjectPointerDown(e, obj.id);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editing) return;
    onStartEdit(obj.id);
  };

  // Diamond polygon points
  const diamondPoints = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;

  return (
    <div
      role="group"
      aria-label={`Shape: ${kind}${label ? `: ${label}` : ''}`}
      data-shape-id={obj.id}
      data-selected={selected}
      data-dragging={dragging || undefined}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: obj.x,
        top: obj.y,
        width,
        height,
        outline: selected ? SELECTION_OUTLINE : 'none',
        outlineOffset: 2,
        cursor: editing ? 'text' : dragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        boxSizing: 'border-box',
        pointerEvents: tool === 'text' || tool === 'shape' || tool === 'connector' ? 'none' : 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        {kind === 'rect' && (
          <rect
            x={SHAPE_STROKE_WIDTH_WORLD / 2}
            y={SHAPE_STROKE_WIDTH_WORLD / 2}
            width={width - SHAPE_STROKE_WIDTH_WORLD}
            height={height - SHAPE_STROKE_WIDTH_WORLD}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
        {kind === 'ellipse' && (
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={width / 2 - SHAPE_STROKE_WIDTH_WORLD / 2}
            ry={height / 2 - SHAPE_STROKE_WIDTH_WORLD / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
        {kind === 'diamond' && (
          <polygon
            points={diamondPoints}
            fill={fill}
            stroke={stroke}
            strokeWidth={SHAPE_STROKE_WIDTH_WORLD}
          />
        )}
      </svg>

      {editing ? (
        <ShapeLabelEditor
          doc={doc}
          id={obj.id}
          width={width}
          height={height}
          onEnd={onEndEdit}
        />
      ) : (
        <div
          ref={labelRef}
          data-testid="shape-label"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            overflow: 'hidden',
            padding: 4,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 14,
            lineHeight: 1.3,
            color: '#222',
            wordWrap: 'break-word',
            overflowWrap: 'break-word',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

function ShapeLabelEditor(props: {
  doc: import('yjs').Doc;
  id: string;
  width: number;
  height: number;
  onEnd(next: 'selected' | 'unselected'): void;
}): JSX.Element {
  const { doc, id, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ytext = getShapeLabel(doc, id);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleChange = () => {
    const el = textareaRef.current;
    if (!el || !ytext) return;
    const val = el.value.slice(0, SHAPE_LABEL_MAX_CHARS);
    el.value = val;
    // Sync to Y.Text (simple full-replace for correctness)
    const current = ytext.toString();
    if (val === current) return;
    doc.transact(() => {
      ytext.delete(0, current.length);
      if (val.length > 0) ytext.insert(0, val);
    });
  };

  const handleBlur = () => {
    onEnd('selected');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEnd('selected');
    }
  };

  return (
    <textarea
      ref={textareaRef}
      data-testid="shape-label-editor"
      defaultValue={ytext?.toString() ?? ''}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: '1px solid #1A73E8',
        resize: 'none',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        lineHeight: 1.3,
        padding: 4,
        boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.9)',
      }}
      maxLength={SHAPE_LABEL_MAX_CHARS}
    />
  );
}
