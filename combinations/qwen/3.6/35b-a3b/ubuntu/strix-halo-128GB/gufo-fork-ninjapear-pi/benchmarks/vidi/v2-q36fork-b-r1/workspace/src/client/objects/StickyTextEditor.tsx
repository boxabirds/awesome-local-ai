import { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@/shared/config';
import { LOCAL_ORIGIN } from '@/shared/board-model';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
  overflow?: boolean;
}

export function StickyTextEditor({
  ytext,
  fontPx,
  onEnd,
  overflow = false,
}: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);

  // On mount: set value, focus, caret at end
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
  }, [ytext]);

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
        onEnd('selected');
        return;
      }
      // Enter inserts newline — default textarea behaviour handles this
    },
    [onEnd],
  );

  const handleBlur = useCallback(() => {
    // Flush any pending value defensively on blur (when not composing)
    if (isComposingRef.current) return;
    const el = textareaRef.current;
    if (!el) return;
    const next = clampToLimit(el.value);
    applyTextDiff(ytext, next, LOCAL_ORIGIN);
  }, [ytext]);

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
