import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { STICKY_TEXT_MAX_CHARS } from '../../shared/config';
import { LOCAL_ORIGIN } from '../../shared/board-model';
import { applyTextDiff, clampToLimit, counterVisible, fitFontSize, NOTE_TEXT_INSET } from './StickyText';

export interface StickyTextEditorProps {
  ytext: Y.Text;
  /** Font size fitted for the note's current text, in board units. */
  fontPx: number;
  onEnd(next: 'selected' | 'unselected'): void;
}

/**
 * The textarea shown while a note is being edited. Every `input` is written to
 * the shared `Y.Text` immediately with a minimal diff, so finishing editing
 * writes nothing further. IME composition is deferred to `compositionend` so
 * composition input never duplicates characters. Enter inserts a new line.
 */
export function StickyTextEditor({ ytext, fontPx, onEnd }: StickyTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const endedRef = useRef(false);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const [length, setLength] = useState(() => ytext.toString().length);

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // The box is in board units, the same units the world layer is drawn in.
    const box = el.clientHeight > 0 ? el.clientHeight : Number.POSITIVE_INFINITY;
    fitFontSize(el, box);
  }, []);

  const flush = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const clamped = clampToLimit(el.value);
    if (clamped !== el.value) {
      // Characters beyond the limit are dropped; the caret stays at the end of
      // the text that was kept.
      const caret = Math.min(el.selectionStart ?? clamped.length, clamped.length);
      el.value = clamped;
      try {
        el.setSelectionRange(caret, caret);
      } catch {
        /* jsdom */
      }
    }
    applyTextDiff(ytext, el.value, LOCAL_ORIGIN);
    setLength(el.value.length);
    fit();
  }, [ytext, fit]);

  // Edit start: value from the document, focus, caret at the end of the text.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = ytext.toString();
    el.value = text;
    setLength(text.length);
    el.focus();
    try {
      el.setSelectionRange(el.value.length, el.value.length);
    } catch {
      /* jsdom */
    }
    fit();
  }, [ytext, fit]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return; // written on compositionend instead
    flush();
  }, [flush]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    flush();
  }, [flush]);

  const finish = useCallback(
    (next: 'selected' | 'unselected') => {
      if (endedRef.current) return;
      endedRef.current = true;
      flush();
      onEndRef.current(next);
    },
    [flush],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish('selected');
      }
      // Enter is left to the textarea, which inserts a new line.
    },
    [finish],
  );

  // A pointerdown anywhere outside the note ends editing and clears selection.
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target) return;
      const note = el.closest('[data-note-id]');
      if (note && note.contains(target)) return;
      if (el.contains(target)) return;
      finish('unselected');
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [finish]);

  return (
    <>
      <textarea
        ref={ref}
        data-testid="sticky-note-editor"
        defaultValue=""
        spellCheck={false}
        onInput={handleInput}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={handleCompositionEnd}
        onKeyDown={handleKeyDown}
        onBlur={flush}
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: NOTE_TEXT_INSET,
          top: NOTE_TEXT_INSET,
          width: `calc(100% - ${NOTE_TEXT_INSET * 2}px)`,
          height: `calc(100% - ${NOTE_TEXT_INSET * 2}px)`,
          padding: 0,
          margin: 0,
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: '#1f1f1f',
          caretColor: '#1f1f1f',
          fontFamily: 'inherit',
          fontWeight: 500,
          lineHeight: 1.25,
          fontSize: fontPx,
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      />
      {counterVisible(length) && (
        <div
          data-testid="sticky-note-counter"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 4,
            fontSize: 11,
            lineHeight: 1,
            color: 'rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }}
        >
          {length}/{STICKY_TEXT_MAX_CHARS}
        </div>
      )}
    </>
  );
}
