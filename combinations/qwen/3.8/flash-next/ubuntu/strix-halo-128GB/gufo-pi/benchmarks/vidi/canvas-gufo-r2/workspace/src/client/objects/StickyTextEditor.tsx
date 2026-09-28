/**
 * Text editing overlay for a sticky note.
 * Mounts a textarea; writes every change into the Y.Text with a minimal diff.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible } from './StickyText';

export function StickyTextEditor(props: {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}): JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const [text, setText] = useState(() => props.ytext.toString());
  const rootRef = useRef<HTMLDivElement | null>(null);

  // On mount: set caret to end, focus
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    const len = ta.value.length;
    ta.setSelectionRange(len, len);
  }, []);

  // Outside pointerdown handler
  const onEndRef = useRef(props.onEnd);
  onEndRef.current = props.onEnd;

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(e.target as Node)) {
        onEndRef.current('unselected');
      }
    };
    // Use a timeout so the current event loop finishes before we listen
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', onPointerDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, []);

  const flushValue = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const next = clampToLimit(ta.value);
    if (next !== ta.value) {
      ta.value = next;
      const len = next.length;
      ta.setSelectionRange(len, len);
    }
    setText(next);
    applyTextDiff(props.ytext, next, LOCAL_ORIGIN);
  }, [props.ytext]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    flushValue();
  }, [flushValue]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flushValue();
  }, [flushValue]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        props.onEnd('selected');
      }
      // Enter inserts newline by default (we don't intercept)
      // Prevent Delete/Backspace from reaching window handlers
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
      }
    },
    [props],
  );

  const showCounter = counterVisible(text.length);

  return (
    <div ref={rootRef} className="sticky-editor">
      <textarea
        ref={textareaRef}
        className="sticky-textarea"
        value={text}
        onChange={handleInput}
        onInput={handleInput}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!composingRef.current) flushValue();
        }}
        style={{ fontSize: `${props.fontPx}px` }}
        aria-label="Sticky note text"
      />
      {showCounter && (
        <span className="sticky-counter" data-testid="sticky-counter">
          {text.length}/{STICKY_TEXT_MAX_CHARS}
        </span>
      )}
    </div>
  );
}
