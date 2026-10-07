import { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';
import type { UndoController } from '@/client/board/undo';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  overflow?: boolean;
  /** Optional undo controller for per-user undo history. */
  undoController?: UndoController | null;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  overflow = false,
  undoController,
}: StickyTextEditorProps) {
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
    const clamped = clampToLimit(next);
    if (clamped !== next) {
      el.value = clamped;
      next = clamped;
      // Restore caret to end of kept text
      el.setSelectionRange(next.length, next.length);
    }

    // Apply diff to Y.Text
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  }, [ytext]);

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    // Process any pending composition result
    const el = textareaRef.current;
    if (!el) return;
    let next = el.value;
    const clamped = clampToLimit(next);
    if (clamped !== next) {
      el.value = clamped;
      next = clamped;
      el.setSelectionRange(next.length, next.length);
    }
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  }, [ytext]);

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
      // so native textarea undo doesn't diverge from Y.Text
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
    const next = clampToLimit(el.value);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
    // Call boundary on blur to close the editing session
    undoController?.boundary();
  }, [ytext, undoController]);

  const remaining = STICKY_TEXT_MAX_CHARS - ytext.toString().length;
  const showCounter = counterVisible(ytext.toString().length);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        aria-label="Edit sticky note"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: 'Arial, sans-serif',
          fontSize: `${fontPx}px`,
          padding: '8px',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          boxSizing: 'border-box',
          color: '#000',
          lineHeight: '1.3',
          pointerEvents: 'auto',
          zIndex: 1,
        }}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        onBlur={handleBlur}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        className={overflow ? 'sticky-text-overflow-fade' : ''}
      />
      {showCounter && (
        <span
          style={{
            position: 'absolute',
            bottom: '2px',
            right: '4px',
            fontSize: '9px',
            color: '#666',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          {ytext.toString().length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
