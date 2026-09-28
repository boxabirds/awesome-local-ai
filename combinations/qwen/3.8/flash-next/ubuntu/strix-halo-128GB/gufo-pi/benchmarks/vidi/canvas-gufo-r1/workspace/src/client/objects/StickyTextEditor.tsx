import { useCallback, useEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * Textarea-based editor for a sticky note.
 * - On mount: sets value from Y.Text, focuses, caret at end.
 * - On input: clamps, applies minimal diff to Y.Text.
 * - On remote ytext changes: updates textarea, preserves caret at end.
 * - Escape: ends editing with 'selected'.
 * - Click outside / blur: ends editing with 'unselected'.
 * - Enter inserts newline (not intercepted).
 * - Shows character counter when near limit.
 */
export function StickyTextEditor(props: StickyTextEditorProps) {
  const { ytext, fontPx, onEnd } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [showCounter, setShowCounter] = useState(
    counterVisible(ytext.toString().length),
  );
  const [charCount, setCharCount] = useState(ytext.toString().length);
  const noteRef = useRef<HTMLDivElement>(null);

  // On mount: set value, focus, caret at end
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = ytext.toString();
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, [ytext]);

  // Handle remote changes: update textarea when ytext changes from remote
  useEffect(() => {
    const handler = (event: Y.YTextEvent, transaction: { local: boolean }) => {
      if (transaction.local) return;
      const ta = textareaRef.current;
      if (!ta) return;
      const newText = event.target.toString();
      ta.value = newText;
      // Place caret at end
      const len = ta.value.length;
      ta.setSelectionRange(len, len);
      setCharCount(newText.length);
      setShowCounter(counterVisible(newText.length));
    };
    ytext.observe(handler);
    return () => ytext.unobserve(handler);
  }, [ytext]);

  // Handle click outside to end editing
  useEffect(() => {
    let active = false;
    // Use a microtask to avoid the event that triggered editing from immediately closing
    Promise.resolve().then(() => { active = true; });
    const handlePointerDown = (e: PointerEvent | MouseEvent) => {
      if (!active) return;
      if (noteRef.current && !noteRef.current.contains(e.target as Node)) {
        onEnd('unselected');
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      active = false;
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onEnd]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    const raw = ta.value;
    const clamped = clampToLimit(raw);
    if (clamped !== raw) {
      ta.value = clamped;
      // Restore caret to end of kept text
      const len = clamped.length;
      ta.setSelectionRange(len, len);
    }
    applyTextDiff(ytext, clamped, 'local');
    setCharCount(clamped.length);
    setShowCounter(counterVisible(clamped.length));
  }, [ytext]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    handleInput();
  }, [handleInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
      }
      // Enter inserts newline in textarea (default behavior, not intercepted)
    },
    [onEnd],
  );

  return (
    <div ref={noteRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        style={{
          fontSize: `${fontPx}px`,
          width: '100%',
          height: '100%',
          border: 'none',
          background: 'transparent',
          resize: 'none',
          outline: 'none',
          padding: '12px',
          fontFamily: 'inherit',
          lineHeight: 1.4,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        onInput={handleInput}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        data-testid="sticky-textarea"
      />
      {showCounter && (
        <span
          className="sticky-counter"
          data-testid="sticky-counter"
          aria-live="polite"
        >
          {charCount}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
