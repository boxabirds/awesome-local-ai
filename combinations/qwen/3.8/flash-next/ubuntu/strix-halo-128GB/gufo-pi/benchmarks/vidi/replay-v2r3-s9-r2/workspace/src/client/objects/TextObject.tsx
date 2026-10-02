import React, { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import type { TextSnapshot } from '../../shared/objects/text';
import { deleteIfEmpty, getTextContent, setTextSize } from '../../shared/objects/text';
import { deleteObject } from '../../shared/board-model';
import {
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../shared/config';
import type { TextSize } from '../../shared/config';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { useTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer } from './textLayout';
import type { Measurer } from './textLayout';
import type { UndoController } from '../board/undo';

export interface TextObjectProps {
  note: TextSnapshot;
  doc: Y.Doc;
  /** Camera zoom; the text scales with the board, its outline does not. */
  zoom: number;
  selected: boolean;
  editing: boolean;
  dragging?: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  /** Generic transform gesture pointer handler (story 7). */
  onObjectPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  /** When false (board failed to load), drag/edit is a no-op. */
  editable?: boolean;
  undoController?: UndoController;
  /** Text measurer; the browser uses the canvas one, tests pass a fake. */
  measure?: Measurer;
}

/** Shared canvas measurer, created on first use (never at import time). */
let sharedMeasurer: Measurer | null = null;
export function getSharedMeasurer(): Measurer {
  if (sharedMeasurer === null) sharedMeasurer = createCanvasMeasurer();
  return sharedMeasurer;
}

/**
 * One text object (story 9): plain text with no fill, placed anywhere. Selection,
 * moving, nudging, deleting and undo are the generic story 7 and 8 operations;
 * this component adds the text editing and the box that follows the content.
 */
export function TextObject({
  note,
  doc,
  zoom,
  selected,
  editing,
  dragging = false,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  editable = true,
  undoController,
  measure,
}: TextObjectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const measurer = measure ?? getSharedMeasurer();
  const { remeasureAfterLocalChange } = useTextBoxSync(doc, note.id, measurer);

  const fontPx = TEXT_SIZES[note.size] ?? TEXT_SIZES.M;
  const autoWidth = note.widthMode !== 'fixed';
  // A text always has a stored box; the fallbacks are for a document written by
  // an older client.
  const width = note.width ?? TEXT_MIN_WIDTH_WORLD;
  const height = note.height ?? fontPx * TEXT_LINE_HEIGHT;

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      // The board must never pan because a press started on text.
      e.stopPropagation();
      if (editing) return;
      if (!editable) return;
      onObjectPointerDown?.(e, note.id);
    },
    [editing, editable, note.id, onObjectPointerDown],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Editing this text, never creating a new object behind it.
      e.stopPropagation();
      if (!editable) return;
      onStartEdit(note.id);
    },
    [note.id, onStartEdit, editable],
  );

  // Focus returns to the text when editing ends, so Delete and arrows still work.
  useEffect(() => {
    if (selected && !editing) rootRef.current?.focus({ preventScroll: true });
  }, [selected, editing]);

  // Editing ends: an object left without a single character disappears, so the
  // board never holds invisible text (TC-20, TC-31).
  const handleEditEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      if (deleteIfEmpty(doc, note.id)) onEndEdit('unselected');
      else onEndEdit(next);
    },
    [doc, note.id, onEndEdit],
  );

  const ytext = editing ? getTextContent(doc, note.id) : undefined;

  // The size presets change the font, so the box is measured again right away.
  const handleSize = useCallback(
    (size: TextSize) => {
      if (!editable) return;
      undoController?.boundary();
      setTextSize(doc, note.id, size);
      remeasureAfterLocalChange();
      undoController?.boundary();
    },
    [doc, note.id, editable, undoController, remeasureAfterLocalChange],
  );

  const handleDelete = useCallback(() => {
    if (!editable) return;
    undoController?.boundary();
    deleteObject(doc, note.id);
    undoController?.boundary();
    onEndEdit('unselected');
  }, [doc, note.id, editable, undoController, onEndEdit]);

  return (
    <div
      ref={rootRef}
      data-object-id={note.id}
      data-text-id={note.id}
      data-testid="text-object"
      data-selected={selected ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      role="group"
      aria-label="Text"
      tabIndex={0}
      style={{
        position: 'absolute',
        left: note.x,
        top: note.y,
        width,
        height,
        boxSizing: 'border-box',
        outline: selected ? '1.5px solid #1976D2' : 'none',
        cursor: editing ? 'text' : 'grab',
        touchAction: 'none',
        userSelect: editing ? 'text' : 'none',
        color: '#1f1f1f',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      <div
        data-testid="text-object-content"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: autoWidth ? 'max-content' : width,
          maxWidth: autoWidth ? TEXT_MAX_AUTO_WIDTH_WORLD : undefined,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'visible',
          fontFamily: TEXT_FONT_FAMILY,
          lineHeight: TEXT_LINE_HEIGHT,
          fontSize: fontPx,
          opacity: editing ? 0 : 1,
          pointerEvents: 'none',
        }}
      >
        {note.text}
      </div>
      {editing && ytext && (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={autoWidth ? 'auto' : width}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEditEnd}
          undo={undoController}
          testId="text-editor"
          containerSelector="[data-object-id]"
        />
      )}
      {selected && !editing && !dragging && (
        <div
          data-testid="text-toolbar-anchor"
          style={{
            position: 'absolute',
            left: 0,
            bottom: '100%',
            // Counteracts the world scale so the toolbar keeps a screen-space size.
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
