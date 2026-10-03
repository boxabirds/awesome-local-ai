import { useCallback, useEffect, useRef, type JSX } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
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
  const { ytext, fontPx, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value, focus, caret at end
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [ytext]);

  // Outside pointerdown → end editing
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el && !el.contains(e.target as Node)) {
        onEnd('unselected');
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [onEnd]);

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

    applyTextDiff(ytext, value, 'local-edit');
  }, [ytext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEnd('selected');
      }
      // Enter inserts a newline (default behaviour, no preventDefault needed)
      // Delete/Backspace are handled by the textarea naturally while editing
    },
    [onEnd],
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
