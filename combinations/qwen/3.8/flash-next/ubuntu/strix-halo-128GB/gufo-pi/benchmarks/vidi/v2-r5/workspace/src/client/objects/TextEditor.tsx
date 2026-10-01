import { useEffect, useRef } from 'react';
import type React from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit } from '../../shared/text-edit';
import type { UndoController } from '../board/undo';

export interface TextEditorProps {
  /** The shared text of the text object; every committed keystroke goes straight into it. */
  ytext: Y.Text;
  /** Maximum characters allowed. */
  maxChars: number;
  /** Font size (board units) used as the editor's font. */
  fontPx: number;
  /** Width of the editor (board units or 'auto'). */
  width: number | 'auto';
  /** Called after each input (for box sync). */
  onInput(): void;
  /** Escape stops editing and keeps the object selected; a press outside drops the selection. */
  onEnd(next: 'selected' | 'unselected'): void;
  /** Undo controller for boundary calls and in-editor undo/redo. */
  undoController?: UndoController;
}

/**
 * Generalised text editor: a plain textarea with minimal diffing into Y.Text.
 * Used by both StickyTextEditor (story 2) and TextObject (story 9).
 *
 * Caret is placed at end on mount. Enter inserts a newline. Escape ends editing.
 * Input is clamped to maxChars. Ctrl/Cmd+Z is routed to the UndoController.
 */
export function TextEditor({ ytext, maxChars, fontPx, width, onInput, onEnd, undoController }: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;
  const undoRef = useRef(undoController);
  undoRef.current = undoController;
  const prevValueRef = useRef<string>('');

  const commit = (raw: string): void => {
    const kept = clampToLimit(raw, maxChars);
    const textarea = textareaRef.current;
    if (textarea && kept.length !== raw.length) {
      textarea.value = kept;
      textarea.setSelectionRange(kept.length, kept.length);
    }

    const prev = prevValueRef.current;
    if (prev !== kept) {
      // Find common prefix
      let start = 0;
      const prevArr = Array.from(prev);
      const nextArr = Array.from(kept);
      while (start < prevArr.length && start < nextArr.length && prevArr[start] === nextArr[start]) {
        start++;
      }
      // Find common suffix
      let endPrev = prevArr.length;
      let endNext = nextArr.length;
      while (endPrev > start && endNext > start && prevArr[endPrev - 1] === nextArr[endNext - 1]) {
        endPrev--;
        endNext--;
      }
      const deletedLen = endPrev - start;
      const insertedStr = nextArr.slice(start, endNext).join('');

      ytext.doc?.transact(() => {
        if (deletedLen > 0) ytext.delete(start, deletedLen);
        if (insertedStr.length > 0) ytext.insert(start, insertedStr);
      }, LOCAL_ORIGIN);

      prevValueRef.current = kept;
    }
    onInputRef.current();
  };

  const flush = (): void => {
    const textarea = textareaRef.current;
    if (textarea) commit(textarea.value);
  };

  // Mount: seed value from doc, focus, caret at end, call boundary (edit start)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const initial = ytext.toString();
    textarea.value = initial;
    prevValueRef.current = initial;
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
    undoRef.current?.boundary();
  }, [ytext]);

  // Unmount: boundary (edit end)
  useEffect(() => {
    return () => {
      undoRef.current?.boundary();
    };
  }, []);

  const handleInput = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    if (composingRef.current) return;
    commit(event.currentTarget.value);
  };

  const widthStyle = width === 'auto' ? 'auto' : `${width}px`;

  return (
    <textarea
      ref={textareaRef}
      className="text-editor"
      data-testid="text-editor"
      aria-label="Text content"
      spellCheck={false}
      style={{
        fontSize: `${fontPx}px`,
        lineHeight: 1.3,
        width: widthStyle,
        minWidth: widthStyle === 'auto' ? 40 : widthStyle,
        resize: 'none',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        commit(event.currentTarget.value);
      }}
      onInput={handleInput}
      onBlur={flush}
      onKeyDown={(event) => {
        const key = event.key.toLowerCase();
        // Ctrl/Cmd+Z: undo
        if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
          event.preventDefault();
          event.stopPropagation();
          const ctrl = undoRef.current;
          if (ctrl) {
            ctrl.undo();
            if (textareaRef.current) {
              const newText = ytext.toString();
              textareaRef.current.value = newText;
              prevValueRef.current = newText;
              const pos = Math.min(newText.length, textareaRef.current.selectionStart);
              textareaRef.current.setSelectionRange(pos, pos);
            }
          }
          return;
        }
        // Ctrl/Cmd+Shift+Z or Ctrl+Y: redo
        if (
          ((event.ctrlKey || event.metaKey) && key === 'z' && event.shiftKey) ||
          (event.ctrlKey && !event.metaKey && key === 'y')
        ) {
          event.preventDefault();
          event.stopPropagation();
          const ctrl = undoRef.current;
          if (ctrl) {
            ctrl.redo();
            if (textareaRef.current) {
              const newText = ytext.toString();
              textareaRef.current.value = newText;
              prevValueRef.current = newText;
              const pos = Math.min(newText.length, textareaRef.current.selectionStart);
              textareaRef.current.setSelectionRange(pos, pos);
            }
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          flush();
          onEndRef.current('selected');
        }
        // Enter: do NOT prevent default → inserts a newline in the textarea
      }}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
}
