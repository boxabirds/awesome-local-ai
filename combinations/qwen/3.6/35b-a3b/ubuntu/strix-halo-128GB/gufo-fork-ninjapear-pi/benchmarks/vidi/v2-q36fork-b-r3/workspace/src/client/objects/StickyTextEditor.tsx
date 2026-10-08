import { useRef, useCallback, useEffect } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  onUndoBoundary(): void;
  onUndo(): boolean;
  onRedo(): boolean;
}

export function StickyTextEditor({ ytext, fontPx, onEnd, onUndoBoundary, onUndo, onRedo }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value from Y.Text, focus, caret at end, and close capture window
  useEffect(() => {
    if (!textareaRef.current) return;
    const text = ytext.toString();
    textareaRef.current.value = text;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(text.length, text.length);
    onUndoBoundary();
  }, [ytext, onUndoBoundary]);

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
      // Intercept undo/redo shortcuts inside the textarea
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      const isUndo =
        isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z';
      const isRedo =
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'y');

      if (isUndo) {
        e.preventDefault();
        e.stopPropagation();
        onUndo();
        return;
      }
      if (isRedo) {
        e.preventDefault();
        e.stopPropagation();
        onRedo();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
      }
      // Enter is allowed for newline insertion (default textarea behaviour)
    },
    [onEnd, onUndo, onRedo],
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
