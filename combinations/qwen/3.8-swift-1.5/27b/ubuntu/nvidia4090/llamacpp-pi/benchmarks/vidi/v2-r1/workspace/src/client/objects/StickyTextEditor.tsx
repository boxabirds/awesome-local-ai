import { useRef, useEffect, useCallback } from 'react';
import * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '@shared/config';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd: (next: 'selected' | 'unselected') => void;
}

export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // On mount: set value, focus, caret at end
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    el.focus();
    el.setSelectionRange(text.length, text.length);
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

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el || composingRef.current) return;
    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, 'editor');
  }, [ytext]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onEnd('selected');
    }
  }, [onEnd]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    const el = textareaRef.current;
    if (!el) return;
    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, 'editor');
  }, [ytext]);

  const text = ytext.toString();
  const showCounter = counterVisible(text.length);

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <textarea
        ref={textareaRef}
        data-testid="sticky-text-editor"
        aria-label="Sticky note text"
        value={text}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          fontSize: `${fontPx}px`,
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          padding: 16,
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          cursor: 'text',
        }}
      />
      {showCounter && (
        <div
          data-testid="char-counter"
          style={{
            position: 'absolute',
            bottom: 2,
            right: 4,
            fontSize: '9px',
            color: 'rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        >
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
