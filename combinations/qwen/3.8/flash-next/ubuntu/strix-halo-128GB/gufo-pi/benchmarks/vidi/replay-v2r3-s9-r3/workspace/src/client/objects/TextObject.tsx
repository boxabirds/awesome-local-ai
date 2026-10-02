import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { TextSnapshot } from '../../shared/objects/text';
import { getTextContent, deleteIfEmpty, setTextSize, setTextBox } from '../../shared/objects/text';
import { TEXT_SIZES, TEXT_FONT_FAMILY, TEXT_MAX_CHARS, TEXT_LINE_HEIGHT, TEXT_MIN_WIDTH_WORLD } from '../../shared/config';
import type { TextSize } from '../../shared/config';
import { getObjectsMap } from '../../shared/board-model';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import type { UndoController } from '../board/undo';
import type { Measurer } from './textLayout';
import { layoutText } from './textLayout';

export interface TextObjectProps {
  note: TextSnapshot;
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
  measure?: Measurer;
  /** Called after local text change to remeasure the box */
  onRemeasure?(): void;
}

/**
 * Renders a text object on the board: plain text, no fill, at x/y with
 * stored width/height, white-space: pre-wrap.
 */
export function TextObject({
  note,
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
  measure,
  onRemeasure,
}: TextObjectProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Compute and store box when text has content but dimensions seem to be initial/missing,
  // or when widthMode/width changes (after resize)
  const lastComputedRef = useRef<string>('');
  useEffect(() => {
    if (!measure || note.text.length === 0) return;
    // Build a key that changes when we need recomputation
    const key = `${note.text.length}:${note.size}:${note.widthMode}:${note.width}`;
    if (key === lastComputedRef.current) return;

    const needsBox = note.widthMode === 'auto'
      ? (note.width <= TEXT_MIN_WIDTH_WORLD)
      : true; // fixed mode always needs correct height

    if (!needsBox) return;

    lastComputedRef.current = key;
    const fixedWidth = note.widthMode === 'fixed' ? note.width : null;
    const result = layoutText(note.text, note.size, note.widthMode, fixedWidth, measure);
    if (result.width !== note.width || result.height !== note.height) {
      setTextBox(doc, note.id, { width: result.width, height: result.height });
    }
  }, [note.width, note.height, note.text, note.size, note.widthMode, note.id, doc, measure]);

  const fontPx = TEXT_SIZES[note.size];
  const width = note.width;
  const height = note.height;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;
      if (onObjectPointerDown) {
        onObjectPointerDown(e, note.id);
      }
    },
    [editing, editable, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(note.id);
    },
    [note.id, onStartEdit, editable],
  );

  // Focus when selected and not editing
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  const handleEditorEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      // Check if text is empty → delete
      const removed = deleteIfEmpty(doc, note.id);
      if (removed) {
        onEndEdit('unselected');
      } else {
        onEndEdit(next);
      }
    },
    [doc, note.id, onEndEdit],
  );

  const handleRemeasure = useCallback(() => {
    onRemeasure?.();
  }, [onRemeasure]);

  const handleSize = useCallback(
    (s: TextSize) => {
      if (!editable) return;
      undoController?.boundary();
      setTextSize(doc, note.id, s);
      onRemeasure?.();
      undoController?.boundary();
    },
    [doc, note.id, editable, undoController, onRemeasure],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    undoController?.boundary();
    const objects = getObjectsMap(doc);
    objects.delete(note.id);
    undoController?.boundary();
    onEndEdit('unselected');
  }, [doc, note.id, editable, undoController, onEndEdit]);

  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  return (
    <div
      ref={rootRef}
      data-note-id={note.id}
      data-text-id={note.id}
      data-testid="text-object"
      data-selected={selected ? 'true' : 'false'}
      role="group"
      aria-label={note.text || 'Empty text'}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width: width > 0 ? width : 'auto',
        height: height > 0 ? height : fontPx * TEXT_LINE_HEIGHT,
        outline: selected ? '2px solid #1976D2' : 'none',
        boxSizing: 'border-box',
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
        fontFamily: TEXT_FONT_FAMILY,
        fontWeight: 400,
        lineHeight: TEXT_LINE_HEIGHT,
        fontSize: fontPx,
        color: '#1f1f1f',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {/* Text content display */}
      <div
        data-testid="text-object-content"
        style={{
          position: 'absolute',
          inset: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: '#1f1f1f',
          fontFamily: 'inherit',
          fontWeight: 'inherit',
          lineHeight: 'inherit',
          fontSize: 'inherit',
          opacity: editing ? 0 : 1,
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {/* Editor when editing */}
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width="auto"
          onInput={handleRemeasure}
          onEnd={handleEditorEnd}
          undoController={undoController}
        />
      )}
      {/* Toolbar when selected and not editing */}
      {selected && !editing && !dragging && (
        <div
          data-testid="text-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            transform: `scale(${1 / (zoom || 1)})`,
            transformOrigin: 'bottom left',
            paddingBottom: 8,
          }}
        >
          <TextToolbar size={note.size} onSize={handleSize} onDelete={handleDelete} />
        </div>
      )}
    </div>
  );
}
