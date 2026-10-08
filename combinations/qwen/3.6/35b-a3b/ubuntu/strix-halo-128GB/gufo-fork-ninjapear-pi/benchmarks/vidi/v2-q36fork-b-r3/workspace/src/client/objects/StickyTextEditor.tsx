import { useRef, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value from Y.Text, focus, caret at end
  useEffect(() => {
    if (!textareaRef.current) return;
    const text = ytext.toString();
    textareaRef.current.value = text;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(text.length, text.length);
  }, [ytext]);

  const handleInput = useCallback(() => {
    if (composingRef.current || !textareaRef.current) return;
    const nextValue = textareaRef.current.value;
    const clamped = clampToLimit(nextValue);
    const clipped = clamped !== nextValue;

    // Restore value if we had to truncate
    if (clipped && textareaRef.current) {
      textareaRef.current.value = clamped;
      const pos = clamped.length;
      textareaRef.current.setSelectionRange(pos, pos);
    }

    applyTextDiff(ytext, clipped ? clamped : nextValue, {});
  }, [ytext]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    // Flush any pending value after IME composition ends
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
      }
      // Enter is allowed for newline insertion (default textarea behaviour)
    },
    [onEnd],
  );

  // Listen for pointerdown outside this editor (handled by parent note)
  // We use an effect to detect outside clicks via a callback registered in the parent.

  return (
    <textarea
      ref={textareaRef}
      onBlur={() => {
        // Blur without Escape: treat as "selected" (keep note selected)
        onEnd('selected');
      }}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        background: 'transparent',
        fontFamily: 'sans-serif',
        fontSize: `${fontPx}px`,
        lineHeight: 1.25,
        padding: '16px',
        textAlign: 'center',
        color: '#333',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        cursor: 'text',
        userSelect: 'text',
        boxSizing: 'border-box',
      }}
      inputMode="text"
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  );
}
