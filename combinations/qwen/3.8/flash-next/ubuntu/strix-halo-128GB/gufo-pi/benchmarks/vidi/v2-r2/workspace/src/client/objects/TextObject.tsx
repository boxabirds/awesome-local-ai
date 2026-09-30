import {
  useRef,
  useCallback,
  useMemo,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import * as Y from 'yjs';
import type { TextObjectSnapshot } from '@shared/board-model';
import { getTextContent, deleteIfEmpty } from '@shared/objects/text';
import { TEXT_SIZES, TEXT_FONT_FAMILY, TEXT_MAX_CHARS } from '@shared/config';
import { TextEditor } from './TextEditor';
import { useTextBoxSync } from './useTextBoxSync';
import { createCanvasMeasurer, type Measurer } from './textLayout';
import type { UndoController } from '@client/board/undo';

export interface TextObjectProps {
  textObj: TextObjectSnapshot;
  doc: Y.Doc;
  zoom: number;
  selected: boolean;
  editing: boolean;
  editable: boolean;
  onObjectPointerDown(e: PointerEvent, id: string): void;
  onStartEdit(id: string): void;
  onEndEdit(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

// Shared measurer instance (created once per module load)
let sharedMeasurer: Measurer | null = null;
export function getMeasurer(): Measurer {
  if (!sharedMeasurer) {
    sharedMeasurer = createCanvasMeasurer(TEXT_FONT_FAMILY);
  }
  return sharedMeasurer;
}

export function TextObject({
  textObj,
  doc,
  zoom: _zoom,
  selected,
  editing,
  editable,
  onObjectPointerDown,
  onStartEdit,
  onEndEdit,
  undoController,
}: TextObjectProps): ReactElement {
  const elRef = useRef<HTMLDivElement | null>(null);
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const onStartEditRef = useRef(onStartEdit);
  onStartEditRef.current = onStartEdit;

  const measurer = useMemo(() => getMeasurer(), []);

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, textObj.id, measurer);

  const handleDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!editableRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      onStartEditRef.current(textObj.id);
    },
    [textObj.id],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const nativeEvent = e.nativeEvent as unknown as PointerEvent;
      onObjectPointerDown(nativeEvent, textObj.id);
    },
    [textObj.id, onObjectPointerDown],
  );

  const handleEditorEnd = useCallback(
    (next: 'selected' | 'unselected') => {
      // Empty text removal happens on edit end
      deleteIfEmpty(doc, textObj.id);
      onEndEdit(next);
    },
    [doc, textObj.id, onEndEdit],
  );

  const fontPx = TEXT_SIZES[textObj.size as keyof typeof TEXT_SIZES] ?? TEXT_SIZES.M;
  const ytext = getTextContent(doc, textObj.id);

  return (
    <div
      ref={elRef}
      role="group"
      aria-label="Text"
      className={`text-object${selected ? ' text-object--selected' : ''}`}
      data-selected={selected ? 'true' : 'false'}
      data-object-id={textObj.id}
      data-testid={`text-object-${textObj.id}`}
      tabIndex={0}
      style={{
        position: 'absolute',
        left: textObj.x,
        top: textObj.y,
        width: textObj.width,
        height: textObj.height,
        fontSize: fontPx,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: '1.3',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: 'inherit',
        background: 'none',
        padding: 0,
        margin: 0,
        overflow: 'hidden',
      }}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
    >
      {editing && ytext && editable ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={fontPx}
          width={textObj.widthMode === 'fixed' ? textObj.width : 'auto'}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEditorEnd}
          undoController={undoController}
        />
      ) : (
        <span data-testid={`text-content-${textObj.id}`}>{textObj.text}</span>
      )}
    </div>
  );
}
