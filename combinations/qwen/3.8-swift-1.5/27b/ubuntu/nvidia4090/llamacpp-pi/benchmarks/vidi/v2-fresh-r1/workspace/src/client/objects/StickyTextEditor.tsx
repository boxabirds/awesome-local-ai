// Text editor for sticky notes: textarea synced to Y.Text with minimal diff.

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value from Y.Text, focus, caret at end
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [ytext]);

  // Outside pointerdown → end editing (unselected)
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) {
        onEnd('unselected');
      }
    };
    // Use capture phase so we get the event before the note's handler
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, [onEnd]);

  const handleInput = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (composingRef.current) return; // handled on compositionend

    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      // Truncated: restore caret to end of kept text
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, 'editor');
  }, [ytext]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEnd('selected');
      }
      // Enter inserts a newline (default textarea behaviour) — no special handling needed
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

  const handleBlur = useCallback(() => {
    // Defensively flush any pending value
    const el = ref.current;
    if (!el) return;
    const value = clampToLimit(el.value);
    if (value !== ytext.toString()) {
      applyTextDiff(ytext, value, 'editor-blur');
    }
  }, [ytext]);

  const text = ytext.toString();
  const showCounter = counterVisible(text.length);

  return (
    <div className="sticky-text-editor" style={{ position: 'absolute', inset: 0 }}>
      <textarea
        ref={ref}
        className="sticky-text-editor__textarea"
        style={{
          fontSize: `${fontPx}px`,
          width: '100%',
          height: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          lineHeight: 1.3,
          padding: '16px',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        aria-label="Sticky note text"
      />
      {showCounter && (
        <span
          className="sticky-text-editor__counter"
          style={{
            position: 'absolute',
            bottom: '4px',
            right: '8px',
            fontSize: '10px',
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
