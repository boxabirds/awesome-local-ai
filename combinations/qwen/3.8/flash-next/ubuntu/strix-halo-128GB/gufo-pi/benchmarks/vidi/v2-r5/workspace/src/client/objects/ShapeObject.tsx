import { useRef, useEffect, useCallback, type PointerEvent as ReactPointerEvent } from 'react';
import type * as Y from 'yjs';
import type { ShapeSnap } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
  SHAPE_DEFAULT_SIZE_WORLD,
} from '../../shared/config';
import type { FillColor, StrokeColor } from '../../shared/config';

/**
 * ShapeObject: renders a shape (rect, ellipse, or diamond) with fill, stroke, and centred label.
 *
 * The label is in a foreignObject sized to the shape's width and height, centred
 * both horizontally and vertically. Double-click starts editing (via Y.Text).
 */
export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onToggle(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: ReactPointerEvent, id: string): void;
  canEdit: boolean;
}

export function ShapeObject({
  shape,
  doc,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  canEdit,
}: ShapeObjectProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);

  // Resolve width/height with defaults (ObjectSnapshot has them optional)
  const w = shape.width ?? SHAPE_DEFAULT_SIZE_WORLD;
  const h = shape.height ?? SHAPE_DEFAULT_SIZE_WORLD;

  // Focus the contenteditable div when editing starts
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus();
    }
    if (editing) wasEditing.current = true;
  }, [editing]);

  // When editing ends, commit text
  useEffect(() => {
    if (!editing && wasEditing.current) {
      wasEditing.current = false;
      onEndEdit('selected');
    }
  }, [editing, onEndEdit]);

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    e.stopPropagation();
    if (editing) return;
    if (onObjectPointerDown) {
      onObjectPointerDown(e, shape.id);
    } else {
      onSelect(shape.id);
    }
  }, [editing, shape.id, onSelect, onObjectPointerDown]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    onStartEdit(shape.id);
  }, [canEdit, shape.id, onStartEdit]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    const ytext = getShapeLabel(doc, shape.id);
    if (!ytext) return;
    // Clamp to max chars
    const text = editorRef.current.innerText;
    if (text.length > SHAPE_LABEL_MAX_CHARS) {
      const truncated = text.slice(0, SHAPE_LABEL_MAX_CHARS);
      ytext.delete(0, ytext.length);
      ytext.insert(0, truncated);
      editorRef.current.innerText = truncated;
    } else {
      ytext.delete(0, ytext.length);
      ytext.insert(0, text);
    }
  }, [doc, shape.id]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onEndEdit('selected');
    }
    // Stop propagation to prevent board keyboard shortcuts
    e.stopPropagation();
  }, [onEndEdit]);

  const fill = SHAPE_FILL_COLORS[shape.fill as FillColor] ?? SHAPE_FILL_COLORS.none;
  const stroke = SHAPE_STROKE_COLORS[shape.stroke as StrokeColor] ?? SHAPE_STROKE_COLORS.dark;

  const renderShapeSvg = () => {
    const sw = SHAPE_STROKE_WIDTH_WORLD;
    const half = sw / 2;
    switch (shape.kind) {
      case 'rect':
        return (
          <rect
            x={half}
            y={half}
            width={w - sw}
            height={h - sw}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        );
      case 'ellipse':
        return (
          <ellipse
            cx={w / 2}
            cy={h / 2}
            rx={(w - sw) / 2}
            ry={(h - sw) / 2}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        );
      case 'diamond':
        return (
          <polygon
            points={`${w / 2},${half} ${w - half},${h / 2} ${w / 2},${h - half} ${half},${h / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={sw}
          />
        );
    }
  };

  return (
    <div
      data-testid="shape-object"
      data-shape-id={shape.id}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: w,
        height: h,
        pointerEvents: 'auto',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={w}
        height={h}
        style={{ position: 'absolute', left: 0, top: 0 }}
        aria-label={`${shape.kind} shape${shape.label ? `: ${shape.label}` : ''}`}
      >
        {renderShapeSvg()}
      </svg>
      <div
        ref={editing ? editorRef : undefined}
        contentEditable={editing}
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          overflow: 'hidden',
          wordWrap: 'break-word',
          overflowWrap: 'break-word',
          fontSize: 14,
          lineHeight: 1.3,
          padding: 4,
          boxSizing: 'border-box',
          outline: 'none',
          userSelect: editing ? 'text' : 'none',
          cursor: editing ? 'text' : 'default',
        }}
      >
        {!editing ? shape.label : undefined}
      </div>
    </div>
  );
}
