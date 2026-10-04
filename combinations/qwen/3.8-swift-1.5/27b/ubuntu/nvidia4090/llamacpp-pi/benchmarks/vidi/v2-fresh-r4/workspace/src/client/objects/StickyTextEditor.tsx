import { useCallback, useEffect, useRef, type JSX } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  /** Close the current undo step (called when editing starts and ends). */
  onBoundary?: () => void;
  /** Undo inside the editor (Ctrl/Cmd+Z). */
  onUndo?: () => void;
  /** Redo inside the editor (Ctrl/Cmd+Shift+Z, Ctrl+Y). */
  onRedo?: () => void;
}

/**
 * Textarea editor for a sticky note's text.
 * - On mount: sets value from Y.Text, focuses, caret at end.
 * - On input: clamps to limit, applies minimal diff to Y.Text.
 * - Escape → onEnd('selected').
 * - Outside pointerdown → onEnd('unselected').
 * - Enter inserts a newline (default textarea behaviour).
 */
export function StickyTextEditor(props: StickyTextEditorProps): JSX.Element {
  const { ytext, fontPx, onEnd, onBoundary, onUndo, onRedo } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value, focus, caret at end.
  // Also close the undo step of the gesture that preceded editing (story 8).
  useEffect(() => {
    onBoundary?.();
    const el = textareaRef.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [ytext, onBoundary]);

  // End of editing closes the typing step (story 8).
  const endEditing = useCallback(
    (next: 'selected' | 'unselected') => {
      onBoundary?.();
      onEnd(next);
    },
    [onBoundary, onEnd],
  );

  // Outside pointerdown → end editing
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el && !el.contains(e.target as Node)) {
        endEditing('unselected');
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [endEditing]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (composingRef.current) return;

    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      // Truncated: restore caret to end of kept text
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }

    applyTextDiff(ytext, value, LOCAL_ORIGIN);
  }, [ytext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        endEditing('selected');
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        onRedo?.();
        return;
      }
      // Enter inserts a newline (default behaviour, no preventDefault needed)
      // Delete/Backspace are handled by the textarea naturally while editing
    },
    [endEditing, onUndo, onRedo],
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const length = ytext.length;
  const showCounter = counterVisible(length);

  return (
    <div className="sticky-text-editor" data-vidi6="sticky-text-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        style={{ fontSize: `${fontPx}px` }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        aria-label="Note text"
        rows={1}
      />
      {showCounter && (
        <span className="sticky-char-counter" data-vidi6="sticky-char-counter" aria-live="polite">
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
