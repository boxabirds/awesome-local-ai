/**
 * ShapeObject: renders an SVG shape (rect, ellipse, diamond) with a centred wrapping label.
 * Double-click starts label editing.
 */

import { useCallback, useRef, useState, type JSX } from 'react';

import type { ShapeSnap } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import { SHAPE_FILL_COLORS, SHAPE_STROKE_COLORS, SHAPE_STROKE_WIDTH_WORLD, SHAPE_LABEL_MAX_CHARS } from '../../shared/config';
import { clampToLimit } from '../../shared/text-edit';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import type * as Y from 'yjs';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  multiSelected: boolean;
  dragging: boolean;
  canEdit: boolean;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undoBoundary(): void;
  undoCtrl: { undo(): boolean; redo(): boolean };
}

export function ShapeObject(props: ShapeObjectProps): JSX.Element {
  const {
    shape,
    doc,
    selected,
    editing,
    dragging,
    canEdit,
    onPointerDown,
    onSelect,
    onStartEdit,
    onEndEdit,
    undoBoundary,
  } = props;

  const w = shape.width ?? 160;
  const h = shape.height ?? 160;
  const fillColor = SHAPE_FILL_COLORS[shape.fill] ?? 'transparent';
  const strokeColor = SHAPE_STROKE_COLORS[shape.stroke] ?? '#263238';
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;

  const [editText, setEditText] = useState(shape.label);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canEdit) return;
    setEditText(shape.label);
    onStartEdit(shape.id);
  }, [canEdit, shape.label, shape.id, onStartEdit]);

  const handleEditChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = clampToLimit(e.target.value, SHAPE_LABEL_MAX_CHARS);
    setEditText(next);
  }, []);

  const handleEditBlur = useCallback(() => {
    undoBoundary();
    const ytext = getShapeLabel(doc, shape.id);
    if (ytext) {
      ytext.doc?.transact(() => {
        const current = ytext.toString();
        if (current !== editText) {
          ytext.delete(0, current.length);
          if (editText.length > 0) ytext.insert(0, editText);
        }
      }, LOCAL_ORIGIN);
    }
    undoBoundary();
    onEndEdit('selected');
  }, [doc, shape.id, editText, onEndEdit, undoBoundary]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      handleEditBlur();
    }
  }, [handleEditBlur]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      onSelect(shape.id);
    } else {
      onPointerDown(e, shape.id);
    }
  }, [shape.id, onPointerDown, onSelect]);

  const shapeElement = buildShapeElement(shape.kind, w, h, fillColor, strokeColor, strokeWidth);

  return (
    <div
      className={`shape-object ${selected ? 'shape-object--selected' : ''}`}
      data-testid={`shape-${shape.id}`}
      data-shape-id={shape.id}
      data-shape-kind={shape.kind}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: w,
        height: h,
        zIndex: shape.z,
        cursor: dragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', top: 0, left: 0 }}
        aria-label={`${shape.kind}${shape.label ? ' ' + shape.label : ''}`}
      >
        {shapeElement}
      </svg>
      {editing ? (
        <textarea
          ref={editorRef}
          data-testid="shape-editor"
          className="shape-label-editor"
          value={editText}
          onChange={handleEditChange}
          onBlur={handleEditBlur}
          onKeyDown={handleEditKeyDown}
          maxLength={SHAPE_LABEL_MAX_CHARS}
          autoFocus
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            border: 'none',
            background: 'transparent',
            resize: 'none',
            padding: 8,
            fontSize: 14,
            fontFamily: 'Inter, system-ui, sans-serif',
            outline: '2px solid #1E88E5',
          }}
        />
      ) : shape.label ? (
        <div
          className="shape-label"
          data-testid={`shape-label-${shape.id}`}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 8,
            fontSize: 14,
            fontFamily: 'Inter, system-ui, sans-serif',
            wordBreak: 'break-word',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {shape.label}
        </div>
      ) : null}
    </div>
  );
}

function buildShapeElement(
  kind: ShapeSnap['kind'],
  width: number,
  height: number,
  fill: string,
  stroke: string,
  strokeWidth: number,
): JSX.Element {
  switch (kind) {
    case 'rect':
      return (
        <rect
          x={strokeWidth / 2}
          y={strokeWidth / 2}
          width={width - strokeWidth}
          height={height - strokeWidth}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={width / 2}
          cy={height / 2}
          rx={(width - strokeWidth) / 2}
          ry={(height - strokeWidth) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case 'diamond':
      return (
        <polygon
          points={`${width / 2},${strokeWidth / 2} ${width - strokeWidth / 2},${height / 2} ${width / 2},${height - strokeWidth / 2} ${strokeWidth / 2},${height / 2}`}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
  }
}
