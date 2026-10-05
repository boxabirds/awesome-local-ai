/**
 * Shape object renderer (story 10). Renders SVG rect/ellipse/diamond with
 * fill/stroke colours and a centred wrapping label.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { JSX } from 'react';
import type * as Y from 'yjs';
import type { ObjectProps } from './registry';
import { SHAPE_STROKE_WIDTH_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';

interface ShapeObjectProps extends ObjectProps {
  // obj contains kind, fill, stroke for shapes
}

export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const { obj, editing, canEdit, onPointerDown, onDoubleClick, doc, onEndEdit } = props;
  const x = obj.x;
  const y = obj.y;
  const width = obj.width ?? 160;
  const height = obj.height ?? 160;
  const kind = (obj.kind ?? 'rect') as string;
  const fill = (obj.fill ?? 'white') === 'none' ? 'transparent' : (obj.fill ?? '#FFFFFF');
  const stroke = obj.stroke ?? '#263238';
  const label = obj.text ?? '';

  const editorRef = useRef<HTMLTextAreaElement>(null);

  // Sync Y.Text to textarea when not editing
  const handleDoubleClick = useCallback(() => {
    if (canEdit) {
      onDoubleClick(obj.id);
    }
  }, [canEdit, onDoubleClick, obj.id]);

  // Focus editor when editing starts
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus();
      // Select all text
      const len = editorRef.current.value.length;
      editorRef.current.setSelectionRange(0, len);
    }
  }, [editing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      onEndEdit?.('selected');
    }
  }, [onEndEdit]);

  const handleBlur = useCallback(() => {
    if (editing) {
      onEndEdit?.('selected');
    }
  }, [editing, onEndEdit]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let value = e.target.value;
    if (value.length > SHAPE_LABEL_MAX_CHARS) {
      value = value.slice(0, SHAPE_LABEL_MAX_CHARS);
    }
    const objects = doc?.getMap('objects') as Y.Map<Y.Map<unknown>> | undefined;
    const objMap = objects?.get(obj.id);
    const ytext = objMap?.get('text') as Y.Text | undefined;
    if (ytext) {
      const current = ytext.toString();
      ytext.delete(0, current.length);
      ytext.insert(0, value);
    }
  }, [doc, obj.id]);

  // Render the shape SVG element
  const renderShape = () => {
    const commonProps = {
      fill,
      stroke,
      strokeWidth: SHAPE_STROKE_WIDTH_WORLD,
    };

    switch (kind) {
      case 'ellipse':
        return (
          <ellipse
            cx={x + width / 2}
            cy={y + height / 2}
            rx={width / 2}
            ry={height / 2}
            {...commonProps}
          />
        );
      case 'diamond':
        const points = [
          `${x + width / 2},${y}`,
          `${x + width},${y + height / 2}`,
          `${x + width / 2},${y + height}`,
          `${x},${y + height / 2}`,
        ].join(' ');
        return <polygon points={points} {...commonProps} />;
      case 'rect':
      default:
        return (
          <rect
            x={x}
            y={y}
            width={width}
            height={height}
            rx={2}
            ry={2}
            {...commonProps}
          />
        );
    }
  };

  return (
    <g
      data-testid={`shape-${obj.id}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e, obj.id);
      }}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: canEdit ? 'move' : 'default' }}
    >
      {renderShape()}
      {/* Label */}
      {editing ? (
        <foreignObject x={x} y={y} width={width} height={height} style={{ overflow: 'hidden' }}>
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
            }}
          >
            <textarea
              ref={editorRef}
              data-testid={`shape-label-editor-${obj.id}`}
              value={label}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                outline: 'none',
                resize: 'none',
                textAlign: 'center',
                verticalAlign: 'middle',
                fontSize: '14px',
                fontFamily: 'Inter, system-ui, sans-serif',
                background: 'transparent',
                overflow: 'hidden',
              }}
              aria-label="Shape label"
            />
          </div>
        </foreignObject>
      ) : (
        label && (
          <foreignObject x={x} y={y} width={width} height={height} style={{ overflow: 'hidden', pointerEvents: 'none' }}>
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
                textAlign: 'center',
                fontSize: '14px',
                fontFamily: 'Inter, system-ui, sans-serif',
                wordWrap: 'break-word',
                overflow: 'hidden',
              }}
            >
              {label}
            </div>
          </foreignObject>
        )
      )}
    </g>
  );
}
