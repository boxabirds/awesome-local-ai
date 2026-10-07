import { useRef, useState, useEffect, useCallback, type CSSProperties, type ReactNode } from 'react';
import * as Y from 'yjs';
import { TEXT_SIZES, DEFAULT_TEXT_SIZE, TEXT_MIN_WIDTH_WORLD } from '@/shared/config';
import { TextEditor } from './TextEditor';
import { getTextContent, setTextBox, isEmptyText, deleteIfEmpty } from '@/shared/objects/text';
import { layoutText, createCanvasMeasurer } from './textLayout';
import type { ObjectSnapshot } from './registry';
import type { UndoController } from '@/client/board/undo';

interface TextObjectProps {
  obj: ObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  onSelect(id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onRemeasure?(id: string): void;
  /** Optional undo controller for per-user undo history. */
  undoController?: UndoController | null;
}

/**
 * Renders a plain text object (no background) at its x/y position with stored width/height.
 * Double-click or Enter (single selection, canEdit) starts editing.
 */
export function TextObject({
  obj,
  doc,
  zoom,
  selected,
  editing,
  onSelect,
  onStartEdit,
  onEndEdit,
  onObjectPointerDown,
  onRemeasure,
  undoController,
}: TextObjectProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pointerState, setPointerState] = useState<'up' | 'pressed'>('up');

  // Get typed dimensions
  const width = (obj.width as number) ?? 100;
  const height = (obj.height as number) ?? TEXT_SIZES[DEFAULT_TEXT_SIZE] * 1.3;
  const sizeKey = ((obj.size as string) ?? DEFAULT_TEXT_SIZE) as keyof typeof TEXT_SIZES;
  const fontPx = TEXT_SIZES[sizeKey] ?? TEXT_SIZES.M;
  const ytext = getTextContent(doc, obj.id);



  // Track whether to show editor (need width for auto mode)
  const editorWidth = width > 0 ? width : 'auto';

  // Handle pointer down
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setPointerState('pressed');
      onObjectPointerDown(e.nativeEvent, obj.id);
    },
    [obj.id, onObjectPointerDown],
  );

  // Handle double click → start editing
  const handleDblClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onStartEdit(obj.id);
    },
    [obj.id, onStartEdit],
  );

  // Handle edit end → remove empty text
  const handleEditEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      // Check if empty — if so, delete it
      if (isEmptyText(doc, obj.id)) {
        deleteIfEmpty(doc, obj.id);
        onEndEdit('unselected');
        return;
      }
      onEndEdit(next);
    },
    [doc, obj.id, onEndEdit],
  );

  // Handle input → remeasure
  const handleInput = useCallback(() => {
    onRemeasure?.(obj.id);
  }, [obj.id, onRemeasure]);

  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    transform: `translate(${obj.x}px, ${obj.y}px)`,
    width: width,
    height: height,
    overflow: 'hidden',
    userSelect: editing ? 'text' : 'none',
    zIndex: obj.z,
  };

  return (
    <div
      ref={containerRef}
      data-testid={`text-${obj.id}`}
      style={style}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDblClick}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={5000}
          fontPx={fontPx}
          width={editorWidth}
          onInput={handleInput}
          onEnd={handleEditEnd}
          undoController={undoController}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            padding: '2px',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: `${fontPx}px`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflow: 'hidden',
            lineHeight: '1.3',
            color: '#000',
            boxSizing: 'border-box',
          }}
        >
          {typeof obj.text === 'string' ? obj.text : String(obj.text ?? '')}
        </div>
      )}
    </div>
  );
}


