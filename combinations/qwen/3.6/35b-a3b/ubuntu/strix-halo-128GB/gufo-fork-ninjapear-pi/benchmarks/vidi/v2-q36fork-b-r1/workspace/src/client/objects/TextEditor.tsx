import { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff } from '@/shared/text-edit';
import { TEXT_MAX_CHARS } from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import type { UndoController } from '@/client/board/undo';

interface TextEditorProps {
  ytext: Y.Text;
  maxChars: number;
  fontPx: number;
  width: number | 'auto';
  onInput(): void;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Optional undo controller for per-user undo history. */
  undoController?: UndoController | null;
}

/**
 * Generalised text editor shared between sticky notes and text objects.
 * - Caret at end on mount
 * - Enter inserts newline (textarea default)
 * - Escape ends editing
 * - Minimal Y.Text diff via applyTextDiff
 * - Clamp to maxChars
 * - Undo boundaries on start/end
 * - Ctrl/Cmd+Z routed to undoController
 */
export function TextEditor({
  ytext,
  maxChars,
  fontPx,
  width,
  onInput,
  onEnd,
  undoController,
}: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  // On mount: set value, focus, caret at end, call boundary() to start a fresh step
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
    // Start a new undo step boundary on edit begin
    undoController?.boundary();
  }, [ytext, undoController]);

  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;

    let next = el.value;

    // Clamp to limit
    const clamped = clampToLimit(next, maxChars);
    if (clamped !== next) {
      el.value = clamped;
      next = clamped;
      // Restore caret to end of kept text
      el.setSelectionRange(next.length, next.length);
    }

    // Apply diff to Y.Text
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    onInput();
  }, [ytext, maxChars, onInput]);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    // Process any pending composition result
    const el = textareaRef.current;
    if (!el) return;
    let next = clampToLimit(el.value, maxChars);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  }, [ytext, maxChars]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        // End editing — call boundary() before ending to close the typing step
        undoController?.boundary();
        onEnd('selected');
        return;
      }

      // Handle undo shortcuts inside the editor with preventDefault
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && undoController) {
        e.preventDefault();
        undoController.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z' && undoController) {
        e.preventDefault();
        undoController.redo();
        return;
      }
      // Ctrl+Y as redo shortcut
      if ((e.ctrlKey || e.metaKey) && e.key === 'y' && undoController) {
        e.preventDefault();
        undoController.redo();
        return;
      }

      // Enter inserts newline — default textarea behaviour handles this
    },
    [onEnd, undoController],
  );

  const handleBlur = useCallback(() => {
    // Flush any pending value defensively on blur (when not composing)
    if (isComposingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;
    const next = clampToLimit(el.value, maxChars);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    // Call boundary on blur to close the editing session
    undoController?.boundary();
    onEnd('unselected');
  }, [ytext, maxChars, onEnd, undoController]);

  const maxWidth = typeof width === 'number' ? width : undefined;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        aria-label="Edit text"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: `${fontPx}px`,
          padding: '2px',
          textAlign: 'left',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          boxSizing: 'border-box',
          color: '#000',
          lineHeight: '1.3',
          pointerEvents: 'auto',
          zIndex: 1,
          ...(maxWidth ? { maxWidth: `${maxWidth}px` } : {}),
        }}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </div>
  );
}
