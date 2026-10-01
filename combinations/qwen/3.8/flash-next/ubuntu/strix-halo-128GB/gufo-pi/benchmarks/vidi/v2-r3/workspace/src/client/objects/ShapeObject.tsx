/**
 * ShapeObject (story 10): SVG shape with centred wrapping label.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import type { ShapeSnap } from '../../shared/objects/shape';
import { getShapeLabel } from '../../shared/objects/shape';
import {
  SHAPE_FILL_COLORS,
  SHAPE_STROKE_COLORS,
  SHAPE_STROKE_WIDTH_WORLD,
  SHAPE_LABEL_MAX_CHARS,
} from '../../shared/config';
import type { UndoController } from '../board/undo';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface ShapeObjectProps {
  shape: ShapeSnap;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  editable?: boolean;
  undoController?: UndoController;
}

export function ShapeObject({
  shape,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  editable = true,
  undoController,
}: ShapeObjectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  const fillColor = SHAPE_FILL_COLORS[shape.fill] ?? 'transparent';
  const strokeColor = SHAPE_STROKE_COLORS[shape.stroke] ?? '#263238';
  const strokeWidth = SHAPE_STROKE_WIDTH_WORLD;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;
      if (onObjectPointerDown) {
        onObjectPointerDown(e, shape.id);
      }
    },
    [editing, editable, shape.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(shape.id);
    },
    [shape.id, onStartEdit, editable],
  );

  // Focus when selected but not editing
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  // Focus editor when editing starts
  useEffect(() => {
    if (editing && editorRef.current) {
      editorRef.current.focus({ preventScroll: true });
    }
  }, [editing]);

  const handleEditorInput = useCallback(() => {
    // Clamp handled by the YText observer
  }, []);

  const handleEditorKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        endEditing();
      }
      // Prevent deletion when no text (would delete object)
      e.stopPropagation();
    },
    [shape.id],
  );

  const handleBlur = useCallback(() => {
    endEditing();
  }, [shape.id]);

  function endEditing() {
    undoController?.boundary();
    onEndEdit('selected');
  }

  const ytext = editing ? getShapeLabel(doc, shape.id) : undefined;

  // Insert text into Y.Text on input
  const insertText = useCallback(
    (text: string) => {
      if (!ytext || !editorRef.current) return;
      const currentStr = editorRef.current.textContent ?? '';
      const yTextStr = ytext.toString();
      if (currentStr === yTextStr) return;
      // Compute diff
      const newLen = Math.min(currentStr.length, SHAPE_LABEL_MAX_CHARS);
      const truncated = currentStr.slice(0, newLen);
      if (truncated === yTextStr) return;
      undoController?.boundary();
      doc.transact(() => {
        ytext.delete(0, ytext.length);
        ytext.insert(0, truncated);
      }, LOCAL_ORIGIN);
      undoController?.boundary();
    },
    [ytext, doc, undoController],
  );

  // Update editor content from YText when it changes externally
  useEffect(() => {
    if (!editing || !ytext || !editorRef.current) return;
    const yStr = ytext.toString();
    if (editorRef.current.textContent !== yStr) {
      editorRef.current.textContent = yStr;
    }
  }, [editing, ytext]);

  // Shape SVG
  const renderShapeSvg = () => {
    const sw = strokeWidth;
    const half = sw / 2;

    if (shape.kind === 'rect') {
      return (
        <svg
          width={shape.width}
          height={shape.height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <rect
            x={half}
            y={half}
            width={shape.width - sw}
            height={shape.height - sw}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={sw}
          />
        </svg>
      );
    } else if (shape.kind === 'ellipse') {
      return (
        <svg
          width={shape.width}
          height={shape.height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <ellipse
            cx={shape.width / 2}
            cy={shape.height / 2}
            rx={(shape.width - sw) / 2}
            ry={(shape.height - sw) / 2}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={sw}
          />
        </svg>
      );
    } else {
      // Diamond
      const points = `${shape.width / 2},${half} ${shape.width - half},${shape.height / 2} ${shape.width / 2},${shape.height - half} ${half},${shape.height / 2}`;
      return (
        <svg
          width={shape.width}
          height={shape.height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <polygon
            points={points}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={sw}
          />
        </svg>
      );
    }
  };

  const ariaLabel = shape.label
    ? `Shape (${shape.kind}): ${shape.label}`
    : `Shape (${shape.kind})`;

  return (
    <div
      ref={rootRef}
      data-shape-id={shape.id}
      data-testid="shape-object"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: shape.x,
        top: shape.y,
        width: shape.width,
        height: shape.height,
        outline: selected ? '2px solid #1976D2' : 'none',
        boxSizing: 'border-box',
        cursor: 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {renderShapeSvg()}
      {/* Label display */}
      {!editing && shape.label && (
        <div
          data-testid="shape-label"
          style={{
            position: 'absolute',
            inset: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            wordBreak: 'break-word',
            overflow: 'hidden',
            color: '#1f1f1f',
            fontSize: 14,
            lineHeight: 1.3,
            pointerEvents: 'none',
          }}
        >
          {shape.label}
        </div>
      )}
      {/* Label editor */}
      {editing && ytext && (
        <div
          ref={editorRef}
          data-testid="shape-label-editor"
          contentEditable
          suppressContentEditableWarning
          style={{
            position: 'absolute',
            inset: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            wordBreak: 'break-word',
            overflow: 'hidden',
            color: '#1f1f1f',
            fontSize: 14,
            lineHeight: 1.3,
            outline: 'none',
            cursor: 'text',
          }}
          onInput={(e) => insertText((e.target as HTMLElement).textContent ?? '')}
          onKeyDown={handleEditorKeyDown}
          onBlur={handleBlur}
        />
      )}
    </div>
  );
}
