import { useRef, useEffect, useState, useCallback } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(() => ytext.toString());
  const composingRef = useRef(false);

  // Focus and set caret at end on mount
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);

  // Listen for external changes to Y.Text (e.g. from other clients in story 3)
  useEffect(() => {
    const handler = () => {
      const external = ytext.toString();
      // Only update if not currently composing
      if (!composingRef.current) {
        setValue(external);
      }
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Handle outside pointerdown to end editing
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = textareaRef.current;
      if (el && !el.contains(e.target as Node)) {
        onEnd('unselected');
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [onEnd]);

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) return;
      const el = e.currentTarget;
      let next = el.value;
      const clamped = clampToLimit(next);
      if (clamped.length !== next.length) {
        // Truncated - restore caret
        next = clamped;
        el.value = next;
        requestAnimationFrame(() => {
          el.setSelectionRange(next.length, next.length);
        });
      }
      setValue(next);
      applyTextDiff(ytext, next, 'sticky-text-editor');
    },
    [ytext]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
      }
      // Enter inserts newline (default textarea behaviour)
    },
    [onEnd]
  );

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      composingRef.current = false;
      const el = e.currentTarget;
      let next = el.value;
      const clamped = clampToLimit(next);
      if (clamped.length !== next.length) {
        next = clamped;
        el.value = next;
      }
      setValue(next);
      applyTextDiff(ytext, next, 'sticky-text-editor');
    },
    [ytext]
  );

  const showCounter = counterVisible(value.length);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        value={value}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: `${fontPx}px`,
          textAlign: 'center',
          overflow: 'hidden',
          padding: '12px',
          boxSizing: 'border-box',
          caretColor: 'black',
        }}
        data-testid="sticky-text-editor"
      />
      {showCounter && (
        <div
          data-testid="sticky-char-counter"
          style={{
            position: 'absolute',
            bottom: '2px',
            right: '4px',
            fontSize: '10px',
            color: '#666',
            pointerEvents: 'none',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
