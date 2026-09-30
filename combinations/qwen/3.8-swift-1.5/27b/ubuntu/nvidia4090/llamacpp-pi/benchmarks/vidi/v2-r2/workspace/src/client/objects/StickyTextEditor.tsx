import { useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Text editing inside a sticky note.
 *
 * - On mount: value from Y.Text, focused, caret at the end.
 * - On `input` (skipped during IME composition; handled on `compositionend`):
 *   clamp to STICKY_TEXT_MAX_CHARS, restore the caret if truncated, then apply
 *   the minimal diff to Y.Text.
 * - Escape → onEnd('selected'). Pointerdown outside the note →
 *   onEnd('unselected'). Ending editing performs no extra write (every input
 *   was already written); blur flushes defensively.
 * - Enter inserts a new line (default textarea behaviour).
 * - The counter shows `n/1000` only within 50 chars of the limit.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Mount: focus and put the caret at the end of the text.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, []);

  // A pointerdown anywhere outside the editor ends editing as unselected.
  // Capture phase so a stopPropagation on another note cannot swallow it.
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      onEndRef.current('unselected');
    };
    window.addEventListener('pointerdown', handler, true);
    return () => window.removeEventListener('pointerdown', handler, true);
  }, []);

  const syncToDoc = (el: HTMLTextAreaElement) => {
    let value = el.value;
    const clamped = clampToLimit(value);
    if (clamped !== value) {
      // Truncated: restore the caret to the end of the kept text.
      value = clamped;
      el.value = value;
      el.setSelectionRange(value.length, value.length);
    }
    applyTextDiff(ytext, value, LOCAL_ORIGIN);
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    syncToDoc(el);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = () => {
    composingRef.current = false;
    const el = ref.current;
    if (!el) return;
    syncToDoc(el);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onEndRef.current('selected');
    }
    // Enter: default behaviour inserts a newline.
  };

  const handleBlur = () => {
    // Defensive flush; every input event was already written to Y.Text.
    const el = ref.current;
    if (el && !composingRef.current && el.value !== ytext.toString()) {
      syncToDoc(el);
    }
  };

  const length = ytext.length;

  return (
    <div style={{ position: 'absolute', inset: 0, userSelect: 'text' }}>
      <textarea
        ref={ref}
        data-testid="sticky-editor"
        aria-label="Sticky note text"
        defaultValue={ytext.toString()}
        spellCheck={false}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          padding: 16,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          fontSize: `${fontPx}px`,
          lineHeight: 1.2,
          textAlign: 'center',
          color: '#333',
          cursor: 'text',
        }}
      />
      {counterVisible(length) && (
        <span
          data-testid="sticky-counter"
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            fontSize: 10,
            color: 'rgba(0,0,0,0.55)',
            pointerEvents: 'none',
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
