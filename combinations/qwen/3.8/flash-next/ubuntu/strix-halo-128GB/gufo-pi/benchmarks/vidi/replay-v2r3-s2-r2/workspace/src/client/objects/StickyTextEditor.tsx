import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import {
  clampToLimit,
  counterVisible,
  applyTextDiff,
  fitFontSize,
} from './StickyText';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { STICKY_TEXT_MAX_CHARS, STICKY_FONT_MAX_PX } from '../../shared/config';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * In-place note editor. On mount it loads the note text, focuses the textarea
 * and places the caret at the end. Each input is clamped to the character limit
 * and written to the Y.Text with a minimal diff, so ending editing never needs
 * an extra write and all typed text is preserved. Escape ends editing as
 * "selected"; a pointerdown outside the note ends editing as "unselected".
 * Enter inserts a newline.
 *
 * The textarea is uncontrolled: the DOM holds the live value so we can clamp
 * and restore the caret without React reconciliation interfering.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const [counterLen, setCounterLen] = useState(() => ytext.toString().length);
  const [size, setSize] = useState(fontPx);
  const [overflow, setOverflow] = useState(false);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const result = fitFontSize(el, el.clientHeight);
    setSize(result.fontPx);
    setOverflow(result.overflow);
  }, []);

  const flush = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      el.value = clamped;
      el.setSelectionRange(clamped.length, clamped.length);
    }
    setCounterLen(clamped.length);
    applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
    fit();
  }, [ytext, fit]);

  const endEdit = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      flush();
      onEnd(next);
    },
    [onEnd, flush],
  );

  // Mount: load text, focus, caret at end, fit once.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = ytext.toString();
    setCounterLen(el.value.length);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detect a pointerdown outside the note → end editing as "unselected".
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const note = el.closest('[data-sticky-note]');
      const target = e.target as Node;
      if (note && !note.contains(target)) {
        endEdit('unselected');
      }
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [endEdit]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    flush();
  }, [flush]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flush();
  }, [flush]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        endEdit('selected');
        return;
      }
      // Keep Delete/Backspace local to the textarea (window handler ignores
      // them while editing anyway, but this stops accidental bubbling).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.stopPropagation();
      }
      // Enter is not intercepted: the textarea inserts a newline.
    },
    [endEdit],
  );

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <textarea
        ref={ref}
        data-testid="sticky-textarea"
        aria-label="Sticky note text"
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Flush defensively; ending is driven by the outside pointerdown.
          if (!endedRef.current && !composingRef.current) flush();
        }}
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          padding: 12,
          boxSizing: 'border-box',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflow: 'hidden',
          color: '#1c1c1c',
          fontSize: size || STICKY_FONT_MAX_PX,
          lineHeight: 1.25,
          caretColor: '#1c1c1c',
        }}
      />
      {overflow && (
        <div
          data-testid="note-overflow-fade"
          className="note-overflow-fade"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 24,
            pointerEvents: 'none',
            background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.85))',
          }}
        />
      )}
      {counterVisible(counterLen) && (
        <div
          data-testid="sticky-counter"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            color: '#555',
            pointerEvents: 'none',
          }}
        >
          {counterLen}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </div>
  );
}
