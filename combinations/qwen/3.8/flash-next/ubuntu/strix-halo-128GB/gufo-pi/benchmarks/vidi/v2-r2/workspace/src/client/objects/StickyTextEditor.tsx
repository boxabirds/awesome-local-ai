import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps): ReactElement {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [text, setText] = useState(() => ytext.toString());
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

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
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      ta.value = clamped;
      // Restore caret to end of kept text
      const pos = clamped.length;
      ta.setSelectionRange(pos, pos);
    }
    setText(clamped);
    applyTextDiff(ytext, clamped, null);
  }, [ytext]);

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
        onEnd('selected');
      }
      // Enter inserts newline in textarea (default behaviour), don't prevent
    },
    [onEnd],
  );

  const showCounter = counterVisible(text.length);

  return (
    <div className="sticky-text-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        value={text}
        style={{ fontSize: `${fontPx}px` }}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        data-testid="sticky-textarea"
      />
      {showCounter && (
        <span className="sticky-char-counter" data-testid="char-counter">
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
