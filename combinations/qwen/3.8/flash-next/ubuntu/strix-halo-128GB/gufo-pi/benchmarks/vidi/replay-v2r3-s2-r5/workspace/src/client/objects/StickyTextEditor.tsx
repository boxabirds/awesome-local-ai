import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { clampToLimit, applyTextDiff, counterVisible } from './StickyText';

/** Text styling shared between the display layer and the editor. */
export const NOTE_FONT_STACK =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
export const NOTE_PADDING = 12;
export const NOTE_LINE_HEIGHT = 1.25;
export const NOTE_TEXT_COLOR = '#1f2937';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  fontPx: number;
  /** Called when editing ends: back to the note itself, or fully deselected. */
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea used while a sticky note is being edited (sticky.text).
 * Every input is written to the shared Y.Text immediately with a minimal diff,
 * so ending editing performs no extra write and nothing typed is lost.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const writtenRef = useRef(ytext.toString());
  const [value, setValue] = useState(ytext.toString());

  // sticky.edit_start: focus with the caret at the end of the current text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try {
      el.setSelectionRange(len, len);
    } catch {
      // Some environments refuse selection ranges on non-text inputs.
    }
  }, []);

  const commit = useCallback(
    (next: string, el: HTMLTextAreaElement) => {
      const clamped = clampToLimit(next);
      setValue(clamped);
      if (writtenRef.current !== clamped) {
        applyTextDiff(ytext, clamped, LOCAL_ORIGIN);
        writtenRef.current = clamped;
      }
      if (clamped !== next) {
        // Characters past the limit are dropped; keep the caret at the end of
        // what was kept.
        const requested = typeof el.selectionStart === 'number' ? el.selectionStart : clamped.length;
        const caret = Math.max(0, Math.min(requested, clamped.length));
        el.value = clamped;
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* ignore */
        }
      }
      return clamped;
    },
    [ytext],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) {
        // IME: wait for compositionend before writing to the shared text.
        setValue(e.currentTarget.value);
        return;
      }
      commit(e.currentTarget.value, e.currentTarget);
    },
    [commit],
  );

  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      composingRef.current = false;
      commit(e.currentTarget.value, e.currentTarget);
    },
    [commit],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pasted = e.clipboardData.getData('text/plain');
      if (!pasted) return;
      e.preventDefault();
      const el = e.currentTarget;
      const from = el.selectionStart ?? value.length;
      const to = el.selectionEnd ?? value.length;
      const next = value.slice(0, from) + pasted + value.slice(to);
      const clamped = commit(next, el);
      const caret = Math.min(from + pasted.length, clamped.length);
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* ignore */
      }
    },
    [commit, value],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        // sticky.edit_end: keep the text, return to the selected note.
        e.preventDefault();
        e.stopPropagation();
        onEnd('selected');
      }
      // Enter inserts a new line (default textarea behaviour).
    },
    [onEnd],
  );

  // Defensive flush: any value not already written goes to the shared text.
  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      if (composingRef.current) return;
      const next = clampToLimit(e.currentTarget.value);
      if (writtenRef.current !== next) {
        applyTextDiff(ytext, next, LOCAL_ORIGIN);
        writtenRef.current = next;
      }
    },
    [ytext],
  );

  return (
    <>
      <textarea
        ref={ref}
        data-testid="sticky-textarea"
        className="vidi6-sticky-textarea"
        aria-label="Sticky note text"
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onBlur={handleBlur}
        spellCheck={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          padding: NOTE_PADDING,
          border: 'none',
          outline: 'none',
          resize: 'none',
          background: 'transparent',
          color: NOTE_TEXT_COLOR,
          fontFamily: NOTE_FONT_STACK,
          fontSize: fontPx,
          lineHeight: NOTE_LINE_HEIGHT,
          textAlign: 'center',
          overflow: 'hidden',
          boxSizing: 'border-box',
          display: 'block',
        }}
      />
      {counterVisible(value.length) && (
        <div
          data-testid="sticky-char-counter"
          className="vidi6-char-counter"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            lineHeight: 1,
            color: 'rgba(31,41,55,0.65)',
            pointerEvents: 'none',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value.length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </>
  );
}
