// src/client/objects/StickyTextEditor.tsx
import { useEffect, useRef, useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
}

export function StickyTextEditor(props: StickyTextEditorProps): ReactElement {
  const { ytext, fontPx, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const [textLen, setTextLen] = useState(() => ytext.toString().length);

  // On mount: set value, focus, caret at end
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.value = ytext.toString();
      ta.focus();
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
    }
  }, [ytext]);

  // Listen for outside pointerdown to end editing
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const ta = textareaRef.current;
      if (ta && !ta.contains(e.target as Node)) {
        onEnd('unselected');
      }
    };
    // Use capture phase so we get the event before the note's handler
    document.addEventListener('pointerdown', handler, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
    };
  }, [onEnd]);

  const handleInput = useCallback(() => {
    if (isComposingRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;

    let value = ta.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      // Truncate and restore caret to end of kept text
      value = clamped;
      ta.value = value;
      ta.setSelectionRange(value.length, value.length);
    }

    applyTextDiff(ytext, value, 'local-edit');
    setTextLen(value.length);
  }, [ytext]);

  const handleCompositionEnd = useCallback(() => {
    isComposingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEnd('selected');
    }
    // Enter inserts newline (default textarea behaviour)
    // Delete/Backspace are handled by the textarea naturally
  }, [onEnd]);

  const showCounter = counterVisible(textLen);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        data-testid="sticky-text-editor"
        onInput={handleInput}
        onCompositionStart={() => { isComposingRef.current = true; }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontSize: `${fontPx}px`,
          fontFamily: 'inherit',
          textAlign: 'center',
          padding: 12,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: 10,
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {textLen}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
