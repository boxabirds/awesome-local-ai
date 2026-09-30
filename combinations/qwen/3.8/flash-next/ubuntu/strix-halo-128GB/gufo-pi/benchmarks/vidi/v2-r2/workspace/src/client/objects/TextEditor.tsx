import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '@shared/text-edit';
import { LOCAL_ORIGIN } from '@shared/board-model';
import type { UndoController } from '@client/board/undo';

export interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  undoController?: UndoController | null;
}

export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undoController,
}: TextEditorProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [text, setText] = useState(() => ytext.toString());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // Signal undo boundary on edit start
  useEffect(() => {
    if (undoController) undoController.boundary();
    return () => {
      if (undoController) undoController.boundary();
    };
  }, [undoController]);

  // Focus and set caret at end on mount
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, []);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw, maxChars);
    if (clamped !== raw) {
      ta.value = clamped;
      // Restore caret to end of kept text
      const pos = clamped.length;
      ta.setSelectionRange(pos, pos);
    }
    setText(clamped);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    onInput();
  }, [ytext, maxChars, onInput]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        (window as any).__vidi6_escapeHandled = true;
        onEnd('selected');
        return;
      }

      // Ctrl/Cmd+Z inside the editor: undo typing (prevent browser's native undo)
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        if (undoController) {
          e.preventDefault();
          undoController.undo();
        }
        return;
      }

      // Ctrl/Cmd+Shift+Z inside the editor: redo typing
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        if (undoController) {
          e.preventDefault();
          undoController.redo();
        }
        return;
      }

      // Ctrl+Y inside the editor: redo typing
      if (
        e.ctrlKey &&
        !e.metaKey &&
        (e.key === 'y' || e.key === 'Y')
      ) {
        if (undoController) {
          e.preventDefault();
          undoController.redo();
        }
        return;
      }

      // Enter inserts newline in textarea (default behaviour), don't prevent
    },
    [onEnd, undoController],
  );

  const widthStyle = width === 'auto' ? 'auto' : `${width}px`;

  return (
    <textarea
      ref={textareaRef}
      className="text-editor"
      data-testid="text-editor"
      value={text}
      style={{
        fontSize: `${fontPx}px`,
        width: widthStyle,
        resize: 'none',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        padding: 0,
        margin: 0,
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: 'inherit',
        lineHeight: '1.3',
        display: 'block',
        minWidth: 40,
      }}
      onInput={handleInput}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      onKeyDown={handleKeyDown}
    />
  );
}
