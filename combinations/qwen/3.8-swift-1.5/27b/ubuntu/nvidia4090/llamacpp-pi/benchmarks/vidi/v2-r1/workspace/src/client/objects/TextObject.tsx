import { useCallback, useMemo } from 'react';
import type { JSX } from 'react';
import type { ObjectProps } from './registry';
import type { TextSnapshot } from '@shared/objects/text';
import {
  getTextContent, isEmptyText, deleteIfEmpty,
} from '@shared/objects/text';
import { useTextBoxSync } from './useTextBoxSync';
import { defaultMeasurer } from './textLayout';
import { TextEditor } from './TextEditor';
import { TEXT_SIZES, TEXT_FONT_FAMILY, TEXT_MAX_CHARS } from '@shared/config';
import { LOCAL_ORIGIN } from '@shared/board-model';
import type { UndoController } from '@client/board/undo';

/**
 * Story 9: renders a free text object (PRD text.render).
 *
 * - Plain text, no fill, no border; the stored box is the hit target.
 * - Tab-reachable and announced by content (PRD text.a11y).
 * - Double-click (or Enter on the selection) starts editing; the shared
 *   TextEditor handles typing, Enter=newline, Escape=stay selected.
 * - On edit end, an object with zero characters is removed (PRD
 *   text.empty_removed) in the same capture window as the last edit, so a
 *   single undo restores it (PRD text.undo).
 */
export function TextObject(props: ObjectProps & { note: TextSnapshot }): JSX.Element {
  const {
    obj, doc, selected, editing,
    onObjectPointerDown, onStartEdit, onEndEdit,
    onUndoBoundary, onUndo, onRedo,
  } = props;
  const note = props.note;
  const id = obj.id;

  const { remeasureAfterLocalChange } = useTextBoxSync(doc, id, defaultMeasurer);

  // Adapt the ObjectProps callbacks to the UndoController interface.
  const undo: UndoController = useMemo(() => ({
    boundary: () => { onUndoBoundary?.(); },
    undo: () => { onUndo?.(); return true; },
    redo: () => { onRedo?.(); return true; },
    canUndo: () => false,
    canRedo: () => false,
    addScope: () => { /* not used by the editor */ },
    onChange: () => () => { /* not used by the editor */ },
    destroy: () => { /* not owned by the editor */ },
  }), [onUndoBoundary, onUndo, onRedo]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    onObjectPointerDown(e, id);
    // Clicking a text object that is being edited ends the editing (it
    // stays selected), so board keys (Delete, arrows) reach the board —
    // the editor covers the box, so an inside click is the only way to
    // "click the object". An abandoned (empty) text is removed by
    // handleEndEdit in the same capture window as the last edit.
    if (editing) onEndEdit('selected');
  }, [id, onObjectPointerDown, editing, onEndEdit]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit(id);
  }, [id, onStartEdit]);

  // End editing: an abandoned (zero-character) text is removed now — in
  // the same capture window as the last edit — so one undo brings it back.
  const handleEndEdit = useCallback((next: 'selected' | 'unselected') => {
    if (isEmptyText(doc, id)) {
      deleteIfEmpty(doc, id);
      onEndEdit('unselected');
      return;
    }
    onEndEdit(next);
  }, [doc, id, onEndEdit]);

  const ytext = getTextContent(doc, id);
  const size = note.size;

  return (
    <div
      data-testid="text-object"
      data-note-id={id}
      role="group"
      aria-label={note.text === '' ? 'Text' : `Text: ${note.text}`}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      style={{
        position: 'absolute',
        left: `${obj.x}px`,
        top: `${obj.y}px`,
        width: `${Math.max(obj.width, 1)}px`,
        height: `${obj.height}px`,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: `${TEXT_SIZES[size]}px`,
        fontFamily: TEXT_FONT_FAMILY,
        lineHeight: 1.3,
        color: '#333',
        background: 'transparent',
        border: 'none',
        cursor: editing ? 'text' : 'grab',
        zIndex: obj.z,
        outline: selected ? '2px solid #2196F3' : 'none',
        outlineOffset: 1,
      }}
    >
      {editing && ytext ? (
        <TextEditor
          ytext={ytext}
          maxChars={TEXT_MAX_CHARS}
          fontPx={TEXT_SIZES[size]}
          width={obj.width}
          onInput={remeasureAfterLocalChange}
          onEnd={handleEndEdit}
          undo={undo}
          ariaLabel="Text"
          testId="text-editor"
          textAlign="left"
          origin={LOCAL_ORIGIN}
        />
      ) : (
        <div data-testid="text-content" style={{ pointerEvents: 'none' }}>
          {note.text}
        </div>
      )}
    </div>
  );
}
