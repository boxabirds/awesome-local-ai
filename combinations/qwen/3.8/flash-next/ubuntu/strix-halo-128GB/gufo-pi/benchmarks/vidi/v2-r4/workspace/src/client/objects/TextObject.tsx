/**
 * TextObject: renders and edits text objects on the board.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import type { ObjectSnapshot } from '../../shared/board-model';
import { deleteObjects } from '../../shared/board-model';
import { getTextContent, deleteIfEmpty, setTextSize } from '../../shared/objects/text';
import { TEXT_SIZES, TEXT_LINE_HEIGHT, TEXT_FONT_FAMILY, type TextSize } from '../../shared/config';
import type { UndoController } from '../board/undo';
import type { Measurer } from './textLayout';
import { useTextBoxSync } from './useTextBoxSync';
import { TextEditor } from './TextEditor';
import { TextToolbar } from './TextToolbar';
import { TEXT_MAX_CHARS } from '../../shared/config';

export interface TextObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  canEdit: boolean;
  onPointerDown?(e: React.PointerEvent<HTMLDivElement>, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(): void;
  onDeleted?(id: string): void;
  undo?: UndoController;
  measurer: Measurer;
}

interface TextObjData {
  text: string;
  size: TextSize;
  widthMode: 'auto' | 'fixed';
}

export function TextObject({
  obj,
  doc,
  zoom,
  selected,
  editing,
  canEdit,
  onPointerDown: onPointerDownProp,
  onStartEdit,
  onEndEdit,
  onDeleted,
  undo,
  measurer,
}: TextObjectProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const textSnap = obj as unknown as TextObjData;
  const fontPx = TEXT_SIZES[textSnap.size] ?? TEXT_SIZES.M;

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, obj.id, measurer);

  const ytext = useMemo(() => getTextContent(doc, obj.id), [doc, obj.id]);

  const handleInput = useCallback(() => {
    remeasureAfterLocalChange();
  }, [remeasureAfterLocalChange]);

  const onEndEditWithCleanup = useCallback(() => {
    // Check if object still exists (may have been deleted remotely)
    const text = getTextContent(doc, obj.id);
    if (!text) {
      // Object was deleted remotely — end editing silently
      onEndEdit();
      return;
    }
    // Check if empty → remove
    if (text.toString().length === 0) {
      if (undo) undo.boundary();
      deleteIfEmpty(doc, obj.id);
      if (undo) undo.boundary();
      onDeleted?.(obj.id);
      onEndEdit();
      return;
    }
    if (undo) undo.boundary();
    onEndEdit();
  }, [doc, obj.id, onEndEdit, onDeleted, undo]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (editing) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.stopPropagation();
    if (onPointerDownProp) {
      onPointerDownProp(event, obj.id);
    }
  };

  // Editing ends on pointerdown outside this object
  useEffect(() => {
    if (!editing) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      onEndEditWithCleanup();
    };
    document.addEventListener('pointerdown', onDocumentPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  }, [editing, onEndEditWithCleanup]);

  // End editing if object is deleted remotely while editing
  useEffect(() => {
    if (!editing) return;
    // This will be triggered by the snapshot prune in useSelection
    // but also ensure the editor unmounts cleanly
  }, [editing]);

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (canEdit) onStartEdit(obj.id);
  };

  const onSizeChange = useCallback((size: TextSize) => {
    if (undo) undo.boundary();
    setTextSize(doc, obj.id, size);
    remeasureAfterLocalChange();
    if (undo) undo.boundary();
  }, [doc, obj.id, undo, remeasureAfterLocalChange]);

  const onDelete = useCallback(() => {
    if (undo) undo.boundary();
    deleteObjects(doc, [obj.id]);
    if (undo) undo.boundary();
    onDeleted?.(obj.id);
    onEndEdit();
  }, [doc, obj.id, undo, onDeleted, onEndEdit]);

  const widthMode = textSnap.widthMode ?? 'auto';
  const storedWidth = obj.width ?? 60;
  const storedHeight = obj.height ?? (fontPx * TEXT_LINE_HEIGHT);

  return (
    <div
      ref={rootRef}
      className="board-object text-object"
      role="group"
      data-testid="text-object"
      data-object-id={obj.id}
      data-world-x={obj.x}
      data-world-y={obj.y}
      data-z={obj.z}
      data-width={String(storedWidth)}
      data-height={String(storedHeight)}
      data-size={textSnap.size}
      data-width-mode={widthMode}
      data-selected={selected ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
      aria-label="Text"
      tabIndex={0}
      style={{
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${storedWidth}px`,
        height: `${storedHeight}px`,
        fontSize: `${fontPx}px`,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: TEXT_LINE_HEIGHT,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'var(--chrome-text)',
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="text-object-content"
        data-testid="text-object-content"
        style={{ opacity: editing ? 0 : 1 }}
      >
        {textSnap.text}
      </div>
      {editing && ytext ? (
        <TextEditor
          key={obj.id}
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={widthMode === 'fixed' ? storedWidth : 'auto'}
          onInput={handleInput}
          onEnd={() => onEndEditWithCleanup()}
          undo={undo!}
        />
      ) : null}
      {selected && !editing ? (
        <div
          className="text-toolbar-anchor"
          data-testid="text-toolbar-anchor"
          style={{
            position: 'absolute',
            top: -36,
            left: 0,
            transform: `scale(${zoom === 0 ? 1 : 1 / zoom})`,
            transformOrigin: 'bottom left',
          }}
        >
          <TextToolbar
            size={textSnap.size}
            onSize={onSizeChange}
            onDelete={onDelete}
          />
        </div>
      ) : null}
    </div>
  );
}
